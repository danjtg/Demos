
#version 430

layout (std140) uniform Matrices
{
	mat4 projViewModelMatrix;
	mat4 viewModel;
	mat4 view;
	mat3 normalMatrix;
	mat4 model;
	mat4 projection;
};

layout (std140) uniform Material
{
	vec4 diffuse;
	vec4 ambient;
	vec4 specular;
	vec4 emissive;
	float shininess;
	int texCount;
};

in vec2 UV;
out vec4 outputF;

uniform vec3 viewDir;

uniform int voxelResolution;
uniform vec3 cameraPos;
uniform float GAMMA;

layout(binding = 0) uniform sampler2D posTex;
layout(binding = 1) uniform sampler2D normTex;
layout(binding = 2) uniform sampler2D matTex;
layout(binding = 3) uniform sampler2D directTex;

layout(binding = 4) uniform sampler3D voxelGridColor;
layout(binding = 5) uniform sampler3D voxelGridNormal;
layout(binding = 6) uniform sampler3D voxelGridIrradiance;

layout(binding = 7) uniform sampler2D volumetricLight;

vec4 voxelFetch(vec3 voxelPos, float sampleLOD)
{
	//vec4 filteredColor = textureLod(voxelGridColor, voxelPos, sampleLOD);
	vec4 filteredIrradiance = textureLod(voxelGridIrradiance, voxelPos, sampleLOD);
	
	//vec4 result = filteredColor * filteredIrradiance;
	//result.a = filteredColor.a;

	return filteredIrradiance;
}

// origin, dir, and maxDist are in texture space
// dir should be normalized
// coneRatio is the cone diameter to height ratio (2.0 for 90-degree cone)
vec4 voxelConeTrace(vec3 origin, vec3 dir, float coneRatio, float maxDist)
{
	vec3 samplePos = origin;
	vec4 accum = vec4(0.0);

	// the starting sample diameter
	float minDiameter = 1.0 / voxelResolution;	// diameter of a voxel on the last level

	// push out the starting point to avoid self-intersection
	float startDist = 2*minDiameter;
	
	float dist = startDist;
	float sampleLOD = 0;
	float startsSampleDiameter = max(minDiameter, coneRatio * dist);

	while (dist <= maxDist && accum.a < 1.0)
	{
		// ensure the sample diameter is no smaller than the min
		// desired diameter for this cone (ensuring we always
		// step at least minDiameter each iteration, even for tiny
		// cones - otherwise lots of overlapped samples)
		float sampleDiameter = max(minDiameter, coneRatio * dist);
		
		// convert diameter to LOD
		// for example:
		// log2(1/256 * 256) = 0
		// log2(1/128 * 256) = 1
		// log2(1/64 * 256) = 2
		sampleLOD = log2(sampleDiameter * voxelResolution);
		
		vec3 samplePos = origin + dir * dist;
		
		vec4 sampleValue = voxelFetch(samplePos, sampleLOD);
		
		sampleValue.a = 1.0 - pow(1.0 - sampleValue.a, (sampleDiameter/2.0)/startsSampleDiameter);

		// Assumes pre-multiplied alpha
		float sampleWeigth = (1.0 - accum.a);
		accum.rgb += sampleValue.rgb * sampleWeigth;
		accum.a += sampleValue.a * sampleWeigth;

		// Pre-multiply alpha
		//vec3 accumVal = (accum.rgb * accum.a);
		
		//accum.rgb = accumVal + sampleWeigth * (sampleValue.a * sampleValue.rgb);
		//accum.a += sampleValue.a * sampleWeigth;

		dist += sampleDiameter/2.0;
	}
	
	return vec4(accum.rgb, 1.0);
}

// Tone Mapping
void logTM(inout vec3 color)
{
	float c = 1.0f / log2(1.0 + 2.0f);
	float greyRadiance = dot(vec3(0.30, 0.59, 0.11), color);
	float mappedRadiance = log2(1.0 + greyRadiance) * c;  
	color *= (mappedRadiance / greyRadiance); 
}

vec3 RayAABBTest(vec3 rayOrigin, vec3 rayDir, vec3 aabbMin, vec3 aabbMax)
{
	float tMin, tMax;

	// Project ray through aabb
	vec3 invRayDir = 1.0 / rayDir;
	vec3 t1 = (aabbMin - rayOrigin) * invRayDir;
	vec3 t2 = (aabbMax - rayOrigin) * invRayDir;

	vec3 tmin = min(t1, t2);
	vec3 tmax = max(t1, t2);

	tMin = max(tmin.x, max(tmin.y, tmin.z));
	tMax = min(min(99999.0, tmax.x), min(tmax.y, tmax.z));

    if (tMin < 0.0) tMin = 0.0;

	vec3 result;
	result.x = (tMax > tMin) ? 1.0 : 0.0;
	result.y = tMin;
	result.z = tMax;
	return result;
}

void main()
{
	
	vec3 position = texture(posTex, UV).xyz;
	vec3 normal = texture(normTex, UV).xyz;
	vec4 material = texture(matTex, UV);
	vec4 direct = texture(directTex, UV);
	vec4 volumetric = texture(volumetricLight, UV);

	//if(position == vec3(0.0)) discard;
	
	vec3 V = normalize(cameraPos - position);
	vec3 N = normalize(normal);

	// Converting Coords from range [-1,1] to range [0,1]
	position = position * 0.5 + 0.5;

	// Specular Reflection
	vec4 specular = vec4(0.0);
	{
		vec3 R = reflect(-V, N);
		
		float coneRatio = 0.1;
		float maxDist = 1.0;
		specular = (voxelConeTrace(position, R, coneRatio, maxDist));
	}
	
	// Indirect Diffuse
	vec4 indirectDiffuse = vec4(0.0);
	vec4 ambientOcclusion = vec4(0.0);
	{
		// Compute Tangent and Bitangent Vectors
		vec3 tangent;
		vec3 c1 = cross(N, vec3(0.0, 0.0, 1.0)); 
		vec3 c2 = cross(N, vec3(0.0, 1.0, 0.0));
		if(length(c1) > length(c2))
		{
			tangent = c1;
		}
		else
		{
			tangent = c2;	
		}
		tangent = normalize(tangent);
		vec3 bitangent = cross(N, tangent); 

		// Set Cone Tracing Parameters
		// Large Cones For Diffuse
		float coneRatio = 1.0;	// 2.0 = 90 degrees
		float maxDist = 0.3;	// [0,1]

		// (dot(normal, normal) == 1)
		indirectDiffuse += voxelConeTrace(position, N, coneRatio, maxDist);
		
		// vectors at 45 degrees dot == 0.707
		indirectDiffuse += 0.707 * voxelConeTrace(position, normalize(normal + tangent), coneRatio, maxDist);
		indirectDiffuse += 0.707 * voxelConeTrace(position, normalize(normal - tangent), coneRatio, maxDist);
		indirectDiffuse += 0.707 * voxelConeTrace(position, normalize(normal + bitangent), coneRatio, maxDist);
		indirectDiffuse += 0.707 * voxelConeTrace(position, normalize(normal - bitangent), coneRatio, maxDist);
		indirectDiffuse /= 80.0;
	}
	vec4 indirect = (indirectDiffuse + 0.5*specular) * material;

	vec4 globalIllum = direct + indirect;	// global
	//vec4 globalIllum = direct;	// direct
	//vec4 globalIllum = indirect;	// indirect
	//vec4 globalIllum = specular;// * material;	// indirect specular
	//vec4 globalIllum = indirectDiffuse;// * material;	// indirect diffuse
	//vec4 globalIllum = ambientOcclusion;	// AO

	// Tone Map
	logTM(globalIllum.rgb);
	outputF = vec4(pow(globalIllum.rgb, vec3(1.0f/GAMMA)), 1.0);
	outputF.rgb += 0.5*volumetric.rgb;
	//outputF = vec4(globalIllum.rgb, 1.0);
	//outputF = vec4(normal,1);
	//outputF = material;
	//outputF = direct;
	
	///////////////////////////////////////////////////////////////////////////////////////////////
	/*
	ivec2 uv = ivec2(gl_FragCoord.xy);
	
	vec3 position = texelFetch(posTex, uv, 0).xyz;

	position = position * 0.5 + 0.5;

	// Converting position from range [0,1] to range [0,voxelresolution] - Grid Coordinates
	position *= voxelResolution;
	
	int sampleLOD = 0;

	vec4 color = texelFetch(voxelGridColor, ivec3(position)>>sampleLOD, sampleLOD);
	vec4 irradiance = texelFetch(voxelGridIrradiance, ivec3(position)>>sampleLOD, sampleLOD);
	
	vec4 filteredColor = textureLod(voxelGridColor, position/voxelResolution, sampleLOD);
	vec4 filteredIrradiance = textureLod(voxelGridIrradiance, position/voxelResolution, sampleLOD);

	outputF = color;
	//outputF = irradiance;
	//outputF = filteredColor;
	//outputF = filteredIrradiance;
	*/
	//////////////////////////////////////////////////////////////////////////////////////
	/*
	vec2 uv = 2 * UV - 1;
	vec3 rayOrigin = (cameraPos*voxelResolution);

	vec3 forward = normalize(cameraPos - viewDir);
	vec3 up = vec3(0,1,0);
	vec3 right = normalize(cross(up, forward));

	float aspectRatio = 1024/768;
	uv.x = uv.x * aspectRatio;
	uv = uv * 0.57;	// fov = 60
	
	vec3 rayDir = normalize(up*uv.y + right*uv.x + forward);

    // Check for ray components being parallel to axes (i.e. values of 0).
	const float epsilon = 0.00001;
	if (abs(rayDir.x) <= epsilon) rayDir.x = epsilon * sign(rayDir.x);
	if (abs(rayDir.y) <= epsilon) rayDir.y = epsilon * sign(rayDir.y);
	if (abs(rayDir.z) <= epsilon) rayDir.z = epsilon * sign(rayDir.z);

	// Calculate inverse of ray direction once.
	vec3 invRayDir = 1.0 / rayDir;
   
    // Perform AABB test with volume.
	vec4 finalColor = vec4(0.4f);
	vec3 result = RayAABBTest(cameraPos, rayDir, vec3(0.0), vec3(1.0));
    if (result.x > 0.0)
    {		
        // Extract out ray's start and end position.
        float tMin = result.y;
        float tMax = result.z;

		vec3 startPos = rayOrigin + rayDir * tMin;
		vec3 voxelPos = max(vec3(0.0), min(vec3(voxelResolution) - vec3(1.0), floor(startPos)));

		// Traverse through voxels until ray exits volume.
		while (all(greaterThanEqual(voxelPos, vec3(0.0))) && all(lessThan(voxelPos, vec3(voxelResolution))))
		{
			// Sample 3D texture at current position.
			vec3 texCoords = voxelPos; // /vec3(voxelResolution);
			//vec4 color = texture(voxelGridColor, texCoords);
			vec4 color = texelFetch(voxelGridIrradiance, ivec3(texCoords), 0);

			// Exit loop if a single sample has an alpha value greater than 0.
			if (color.a > 0.0)
			{
				//if (color.a == 1.0)
					//finalColor = vec4(0,1,0,1);
				//else finalColor = vec4(1,0,0,1);
				finalColor = color;
				break;
			}

			// Move to next closest voxel along ray.
			vec3 t0 = (voxelPos - startPos) * invRayDir;
			vec3 t1 = (voxelPos + vec3(1.0) - startPos) * invRayDir;
			vec3 tmax = max(t0, t1);
			float t = min(tmax.x, min(tmax.y, tmax.z));
			if (tmax.x == t) voxelPos.x += sign(rayDir.x);
			else if (tmax.y == t) voxelPos.y += sign(rayDir.y);
			else if (tmax.z == t) voxelPos.z += sign(rayDir.z);
		}
    }
    
	// Write final color to framebuffer.
	outputF = finalColor;
	*/
}
