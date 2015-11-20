
#version 430

#define PI 3.14159265359f

in vec2 UV;

layout(location = 0) out vec4 result;

uniform float diffuseGIPower;
uniform float maxTraceDist;
uniform float reflectionAmplifier;
uniform float coneSlope;
uniform vec3 cameraPos;

uniform float resolutionGridExtent;
uniform float inverseFineGridCellSize;
uniform float inverseCoarseGridCellSize;

layout(binding = 0) uniform sampler2D positionBuffer; // G-buffer texture with world space positions
layout(binding = 1) uniform sampler2D normalBuffer;   // G-buffer texture with world space normals
layout(binding = 2) uniform sampler2D directLightBuffer;	// Texture with direct lighting

// FINE_GRID
layout(binding = 3) uniform sampler3D redSHFine;	// redSHCoeffs
layout(binding = 4) uniform sampler3D greenSHFine;	// greenSHCoeffs
layout(binding = 5) uniform sampler3D blueSHFine;	// blueSHCoeffs

// COARSE_GRID
layout(binding = 6) uniform sampler3D redSHCoarse;	// redSHCoeffs
layout(binding = 7) uniform sampler3D greenSHCoarse;	// greenSHCoeffs
layout(binding = 8) uniform sampler3D blueSHCoarse;	// blueSHCoeffs

layout(binding = 9) uniform sampler3D reflectionGrid;	// reflection Grid

layout(binding = 10) uniform sampler2D direct;	// reflection Grid


// A clamped cosine lobe function oriented in Z direction is used and expressed
// as spherical harmonics. Since the function has rotational symmetry around the
// Z axis, the SH projection results in zonal harmonics. The rotation of zonal
// harmonics can be done simpler as for general spherical harmonics. The below
// function returns zonal harmonics, rotated into the specified direction.
vec4 ClampedCosineCoeffs(in vec3 dir)
{
	vec4 coeffs;
	coeffs.x = 0.8862269262f;         // PI/(2*sqrt(PI))
	coeffs.y = -1.0233267079f;        // -((2.0f*PI)/3.0f)*sqrt(3/(4*PI))
	coeffs.z = 1.0233267079f;         // ((2.0f*PI)/3.0f)*sqrt(3/(4*PI))
	coeffs.w = -1.0233267079f;        // -((2.0f*PI)/3.0f)*sqrt(3/(4*PI))
	coeffs.wyz *= dir;
	return coeffs;
}

// After calculating the texCoords into the 2D texture arrays, the SH-coeffs are trilinearly sampled and
// finally a SH-lighting is done to generate the diffuse global illumination.
vec3 GetDiffuseIllum(in vec3 offset, in vec4 surfaceNormalLobe, in sampler3D redSHCoeffsMap, in sampler3D greenSHCoeffsMap, in sampler3D blueSHCoeffsMap)
{
	// get texCoords into 3D textures
	vec3 texCoords = vec3(16.5f, 16.5f, 16.0f) + offset;
	texCoords.xyz /= 32.0f;

	// sample red/ green/ blue SH-coeffs trilinearly from the 3D textures
	vec4 redSHCoeffs = texture(redSHCoeffsMap, texCoords);
	vec4 greenSHCoeffs = texture(greenSHCoeffsMap, texCoords);
	vec4 blueSHCoeffs = texture(blueSHCoeffsMap, texCoords);

	// Do diffuse SH-lighting by simply calculating the dot-product between the SH-coeffs from the virtual
	// point lights and the surface SH-coeffs.
	vec3 vDiffuse;
	vDiffuse.r = dot(redSHCoeffs, surfaceNormalLobe);
	vDiffuse.g = dot(greenSHCoeffs, surfaceNormalLobe);
	vDiffuse.b = dot(blueSHCoeffs, surfaceNormalLobe);

	return vDiffuse;
}

void logTM(inout vec3 color)
{
	float c = 1.0f / log2(1.0 + 2.0f);
	float greyRadiance = dot(vec3(0.30, 0.59, 0.11), color);
	float mappedRadiance = log2(1.0 + greyRadiance) * c;  
	color *= (mappedRadiance / greyRadiance); 
}

void main()
{
	vec3 position = texture(positionBuffer, UV).xyz;
	vec3 normal = texture(normalBuffer, UV).xyz;
	vec4 albedoGloss = texture(directLightBuffer, UV);	// Direct
	vec3 directLight = texture(direct, UV).xyz;

	// Indirect Diffuse
	vec3 diffuseIllum = vec3(0.0f, 0.0f, 0.0f);
	{
		// get surface SH-coeffs
		vec4 surfaceNormalLobe = ClampedCosineCoeffs(normal);

		// get offset into fine resolution grid
		vec3 offset = (position)*inverseFineGridCellSize;	// CAMERA

		// The distance for lerping between fine and coarse resolution grid has to be calculated with
		// the unsnapped grid-center, in order to avoid artifacts in the lerp area.
		vec3 lerpOffset = (position)*inverseFineGridCellSize;
		float lerpDist = length(lerpOffset);

		// get diffuse global illumination from fine resolution grid
		vec3 fineDiffuseIllum = GetDiffuseIllum(offset, surfaceNormalLobe, redSHFine, greenSHFine, blueSHFine);
		
		// get offset into coarse resolution grid
		offset = (position.xyz)*inverseCoarseGridCellSize;

		// get diffuse global illumination from coarse resolution grid
		vec3 coarseDiffuseIllum = GetDiffuseIllum(offset, surfaceNormalLobe, redSHCoarse, greenSHCoarse, blueSHCoarse);
		
		// lerp between results from both grids
		float factor = clamp((lerpDist - 12.0f) * 0.25f, 0.0f, 1.0f);
		diffuseIllum = mix(fineDiffuseIllum, coarseDiffuseIllum, factor);
		diffuseIllum = max(diffuseIllum, vec3(0));
		diffuseIllum /= PI;
		diffuseIllum = pow(diffuseIllum, vec3(diffuseGIPower));
	}

	// Indirect Specular
	vec3 reflection = vec3(0.0f, 0.0f, 0.0f);
	{
		vec3 viewVec = normalize(cameraPos - position);
		vec3 reflectVec = 2.0f * dot(viewVec, normal) * normal - viewVec;

		vec3 startPos = position*inverseFineGridCellSize*8.0f;
		startPos += vec3(128.5f, 128.5f, 128.5f);
 
 		float slope = coneSlope; // slope of cone used for tracing
		float stepSize = 0.25f;
		float traceDistance = 1.0f/clamp(dot(normal, viewVec), 0.001f, 1.0f); // ensure that cone starts outside of current cell
		float occlusion = 0.0f;
		
		while(traceDistance <= maxTraceDist)
		{
			float sampleDiameter = max(stepSize, slope * traceDistance); // prevent too small steps
			float level = log2(sampleDiameter / stepSize); // calculate mip-map level
			vec3 samplePos = (reflectVec * traceDistance) + startPos;
			vec3 texCoords = samplePos / 256.0f;

			// stop tracing when boundaries of grid are exceeded
			if((texCoords.x < 0.0f) || (texCoords.x > 1.0f) || (texCoords.y < 0.0f) || (texCoords.y > 1.0f) || (texCoords.z < 0.0f) || (texCoords.z > 1.0f))
				break;
		
			// fade out sampled values with maximum propagation distance to be synchronous with propagated virtual point lights
			float fade = clamp(traceDistance / maxTraceDist, 0.0f, 1.0f);
			vec4 colorOcclusion = textureLod(reflectionGrid, texCoords, level) * fade;

			// accumulate occlusion and stop tracing at full occlusion
			occlusion += colorOcclusion.a;
			if(occlusion >= 1.0f)
				break;

		    // Accumulate reflection by weighting with inverse occlusion. Additionally weight by the inverse of fade to prevent 
			// blocky occlusion artifacts due to the limited resolution of the reflection voxel-grid (256x256x256).
			float sampleWeight = (1.0f - occlusion) * (1.0f - fade);
			reflection += colorOcclusion.rgb * sampleWeight;
			
			// step along reflection cone
			traceDistance += sampleDiameter;
		}

		// Fade out accumulated reflection with the distance to reflection-grid center. In combination with writing initially
		// the color values the same way into the reflection-grid, this ensures a smooth fade-out of the reflections as the 
		// viewer camera moves.
		reflection *= 1.0f - clamp(length(position)/resolutionGridExtent, 0.0f, 1.0f);

		reflection *= reflectionAmplifier;
	}

    diffuseIllum *= albedoGloss.rgb;
    reflection *= albedoGloss.a;

	//vec3 outputColor = diffuseIllum;
	//vec3 outputColor = reflection;
	vec3 outputColor = diffuseIllum + reflection;

	outputColor += directLight;

	// Tone Map
	logTM(outputColor);
	result = vec4(pow(outputColor, vec3(1.0f/2.2f)), 1.0);

	//result = vec4(outputColor, 1.0f);
}
