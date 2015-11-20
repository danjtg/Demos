
#version 430

#define PCF_NUM_SAMPLES 16
#define SHADOW_FILTER_RADIUS 2.0f
#define SHADOW_BIAS 0.02f

in vec2 UV;
flat in uint rtIndex;

layout(binding = 0) uniform sampler2DShadow shadowMap;

struct Voxel
{
	uint colorOcclusionMask;
	uvec4 normalMasks;
};

layout(binding = 1, std430) buffer GridBuffer
{
	Voxel gridBuffer[];
};

layout(binding = 2, rgba16f) writeonly uniform image3D redSH;	// redSHCoeffs
layout(binding = 3, rgba16f) writeonly uniform image3D greenSH;	// greenSHCoeffs
layout(binding = 4, rgba16f) writeonly uniform image3D blueSH;	// blueSHCoeffs

uniform vec3 cameraPos;
uniform vec3 lightPosition;
uniform vec3 lightColor;
uniform float lightMultiplier;
uniform float shadowBias;
uniform float shadowFilterRadius;
uniform float inverseSMResolution;
uniform mat4 shadowMapProjection;
uniform mat4 shadowMapView;
uniform float gridCellSize;

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

// compute shadow-term using 16x PCF in combination with hardware shadow filtering
float ComputeShadowTerm(in vec4 position)
{
	// compute shadow-term using 16x PCF in combination with hardware shadow filtering
	vec4 shadowCoord = shadowMapProjection * shadowMapView * position;
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

// get index into a 32x32x32 grid for the specified position
int GetGridIndex(in ivec3 position)
{
	return ((position.z * 1024) + (position.y * 32) + position.x);
}

// Decode specified mask into a float3 color (range 0.0f-1.0f).
vec3 DecodeColor(in uint colorMask)
{
	vec3 color;
	color.r = (colorMask>>16U) & 0x000000FF;
	color.g = (colorMask>>8U) & 0x000000FF;
	color.b = colorMask & 0x000000FF;
	color /= 255.0f;
	return color;
}

// Decode specified mask into a vec3 normal (normalized).
vec3 DecodeNormal(in uint normalMask)
{
	ivec3 iNormal;
	iNormal.x = int((normalMask>>18) & 0x000000FF);   
	iNormal.y = int((normalMask>>9) & 0x000000FF);
	iNormal.z = int(normalMask & 0x000000FF);
	
	ivec3 iNormalSigns;
	iNormalSigns.x = int((normalMask>>25) & 0x00000002);
	iNormalSigns.y = int((normalMask>>16) & 0x00000002);
	iNormalSigns.z = int((normalMask>>7) & 0x00000002);
	iNormalSigns = 1-iNormalSigns;
	
	vec3 normal = vec3(iNormal)/255.0f;
	normal *= iNormalSigns; 
	return normal;
}

// Determine which of the 4 specified normals (encoded as normalMasks) is closest to 
// the specified direction. The function returns the closest normal and as output 
// parameter the corresponding dot-product.
vec3 GetClosestNormal(in uvec4 normalMasks, in vec3 direction, out float dotProduct)
{  
	mat4x3 normalMatrix;
	normalMatrix[0] = DecodeNormal(normalMasks.x);
	normalMatrix[1] = DecodeNormal(normalMasks.y);
	normalMatrix[2] = DecodeNormal(normalMasks.z);
	normalMatrix[3] = DecodeNormal(normalMasks.w);
	vec4 dotProducts = direction * normalMatrix;

	float maximum = max(max(dotProducts.x, dotProducts.y), max(dotProducts.z, dotProducts.w));
	uint index;
	if(maximum == dotProducts.x)
		index = 0;
	else if(maximum == dotProducts.y)
		index = 1;
	else if(maximum == dotProducts.z)
		index = 2;
	else 
		index = 3;

	dotProduct = dotProducts[index];
	return normalMatrix[index];
}

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

void main() 
{
	// get index of current voxel
	ivec3 voxelPos = ivec3(gl_FragCoord.xy, rtIndex);
	int gridIndex = GetGridIndex(voxelPos);

	// get voxel data and early out, if voxel has no geometry info 
	Voxel voxel = gridBuffer[gridIndex];
	if((voxel.colorOcclusionMask & (1<<31U)) == 0)
	{
		imageStore(redSH, voxelPos, vec4(0));
		imageStore(greenSH, voxelPos, vec4(0));
		imageStore(blueSH, voxelPos, vec4(0));
		discard;
	}

	// get world-space position of voxel
	ivec3 offset = voxelPos - ivec3(16);
	vec3 position = vec3(offset) * gridCellSize;

	vec3 lightVecN = -normalize(lightPosition);	// NEGATIVE?

	// decode color of voxel
	vec3 albedo = DecodeColor(voxel.colorOcclusionMask);

	// get normal of voxel that is closest to the light-direction
	float nDotL;
	vec3 normal = GetClosestNormal(voxel.normalMasks, lightVecN, nDotL);

	// compute shadowTerm by re-using shadowMap from direct illumination
	float shadowTerm = ComputeShadowTerm(vec4(position, 1.0f));

	// compute diffuse illumination
	vec3 vDiffuse = albedo * lightColor * clamp(nDotL, 0.0f, 1.0f) * lightMultiplier * max(0.05,shadowTerm);

	// turn illuminated voxel into virtual point light, represented by second order spherical harmonics coeffs
	vec4 coeffs = ClampedCosineCoeffs(normal);
	vec3 flux = vDiffuse;
	vec4 redSHCoeffs = coeffs * flux.r;
	vec4 greenSHCoeffs = coeffs * flux.g;
	vec4 blueSHCoeffs = coeffs * flux.b;
	
	// output red/ green/ blue SH-coeffs
	imageStore(redSH, voxelPos, redSHCoeffs);
	imageStore(greenSH, voxelPos, greenSHCoeffs);
	imageStore(blueSH, voxelPos, blueSHCoeffs);
}
