#version 430

#define PCF_NUM_SAMPLES 16

uniform int voxelResolution;

uniform vec3 lightPosition;
uniform vec4 lightColor;

uniform mat4 shadowMapProjection;
uniform mat4 shadowMapView;
uniform float shadowBias;
uniform float shadowFilterRadius;
uniform float inverseSMResolution;
uniform int grid;

layout(binding = 0) uniform sampler2DShadow shadowMap;

layout(binding = 1) uniform samplerBuffer fragmentListPosition;
layout(binding = 2) uniform samplerBuffer fragmentListColor;
layout(binding = 3) uniform samplerBuffer fragmentListNormal;

layout(binding = 1, r32ui) coherent volatile uniform uimage3D voxelGrid;


vec4 convRGBA8ToVec4(uint val)
{
	return vec4(float((val & 0x000000FF)), float((val & 0x0000FF00) >> 8U), float((val & 0x00FF0000) >> 16U), float((val & 0xFF000000) >> 24U));
}

uint convVec4ToRGBA8(vec4 val)
{
	return (uint(val.w) & 0x000000FF) << 24U | (uint(val.z) & 0x000000FF) << 16U | (uint(val.y) & 0x000000FF) << 8U | (uint(val.x) & 0x000000FF);
}

// poisson disk samples
vec2 filterKernel[PCF_NUM_SAMPLES] =
{ 
	vec2(-0.94201624f, -0.39906216f),
	vec2(0.94558609f, -0.76890725f),
	vec2(-0.094184101f, -0.92938870f),
	vec2(0.34495938f, 0.29387760f),
	vec2(-0.91588581f, 0.45771432f),
	vec2(-0.81544232f, -0.87912464f),
	vec2(-0.38277543f, 0.27676845f),
	vec2(0.97484398f, 0.75648379f),
	vec2(0.44323325f, -0.97511554f),
	vec2(0.53742981f, -0.47373420f),
	vec2(-0.26496911f, -0.41893023f),
	vec2(0.79197514f, 0.19090188f),
	vec2(-0.24188840f, 0.99706507f),
	vec2(-0.81409955f, 0.91437590f),
	vec2(0.19984126f, 0.78641367f),
	vec2(0.14383161f, -0.14100790f)
};

void imageAtomicRGBA8Avg(layout(r32ui) coherent volatile uimage3D grid, ivec3 coords, vec4 value)
{
	value.rgb *= 255.0;
	uint newVal = convVec4ToRGBA8(value);
	uint prevStoredVal = 0;
	uint curStoredVal;

	while((curStoredVal = imageAtomicCompSwap(grid, coords, prevStoredVal, newVal)) != prevStoredVal)
	{
		prevStoredVal = curStoredVal;
		vec4 rval = convRGBA8ToVec4(curStoredVal);
		rval.rgb = (rval.rgb * rval.a);	// Denormalize
		vec4 curValF = rval + value;	// Add
		curValF.rgb /= curValF.a;	// Renormalize
		newVal = convVec4ToRGBA8(curValF);
	}
}

float calcShadowing(vec4 worldPos)
{
	// compute shadow-term using 16x PCF in combination with hardware shadow filtering
	vec4 shadowCoord = shadowMapProjection * shadowMapView * worldPos;
	shadowCoord.xyz /= shadowCoord.w;
    shadowCoord.xyz = shadowCoord.xyz * 0.5 + 0.5;
	
	float filterRadius = shadowFilterRadius * inverseSMResolution;
	float compareDepth = shadowCoord.z - shadowBias;
	float shadowTerm = 0.0f;

	for(int i = 0; i < PCF_NUM_SAMPLES; i++)
	{
		vec2 offset = filterKernel[i] * filterRadius;
		vec2 texCoords = shadowCoord.xy + offset;
		shadowTerm += texture(shadowMap, vec3(texCoords, compareDepth));
	}
	shadowTerm /= PCF_NUM_SAMPLES;
	return shadowTerm;
}

void main()
{
	vec4 fragmentPosition = texelFetch(fragmentListPosition, gl_VertexID);

	//if(fragmentPosition == vec4(0)) return;	// maybe change the threshold
	
	vec4 result = vec4(0);

	if (grid == 0)	// color
	{
		vec4 fragmentColor = texelFetch(fragmentListColor, gl_VertexID);
		result = fragmentColor;
	}
	
	if (grid == 1)	// normal
	{
		vec4 fragmentNormal = texelFetch(fragmentListNormal, gl_VertexID);
		result = fragmentNormal;
	}

	if (grid == 2)	// Irradiance
	{
		vec4 fragmentColor = texelFetch(fragmentListColor, gl_VertexID);
		vec3 fragmentNormal = texelFetch(fragmentListNormal, gl_VertexID).xyz * 2.0 - 1.0;

		vec3 N = normalize(fragmentNormal);
		vec3 L = normalize(lightPosition);
		float NdotL = max(dot(N,L), 0.0);
		
		float shadowing = calcShadowing(fragmentPosition * 2.0 - 1.0);
		// Do not multiply by light intensity to prevent overflow during averaging
		vec3 incomingRadiance = max(0.02,shadowing) * (fragmentColor.rgb * lightColor.rgb * NdotL);
		result = vec4(incomingRadiance, 1.0);
	}
	
	imageAtomicRGBA8Avg(voxelGrid, ivec3(fragmentPosition.xyz * voxelResolution), result);
	//imageStore(voxelGrid, ivec3(fragmentPosition.xyz), result);
}
