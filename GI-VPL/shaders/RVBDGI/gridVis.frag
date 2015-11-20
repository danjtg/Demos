
#version 430

#define FINE_GRID 0
#define COARSE_GRID 1
#define REFLECTION_GRID 2

in vec2 UV;

layout(location = 0) out vec4 result;

uniform int grid;
uniform float inverseFineGridCellSize;
uniform float inverseCoarseGridCellSize;
uniform vec3 cameraPos;

layout(binding = 0) uniform sampler2D positionBuffer; // G-buffer texture with world space positions
layout(binding = 1) uniform sampler3D reflectionGrid;	// reflection Grid

struct Voxel
{
	uint colorOcclusionMask;
	uvec4 normalMasks;
};

layout(binding = 2, std430) buffer FineGridBuffer
{
	Voxel fineGridBuffer[];
};

layout(binding = 3, std430) buffer CoarseGridBuffer
{
	Voxel coarseGridBuffer[];
};

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

void main() 
{
	vec3 position = texture(positionBuffer, UV).xyz;

	vec3 color = vec3(0.5f, 0.5f, 0.5f);

	if(position == vec3(0)) discard;

	if (grid == REFLECTION_GRID)
	{
		vec3 offset = (position) * (inverseFineGridCellSize*8.0f);	// CAMERA
		float squaredDist = dot(offset, offset);
		if(squaredDist <= (127.0f * 127.0f))
		{
			ivec3 voxelPos = ivec3(offset) + ivec3(128);
			//color = texelFetch(reflectionGrid, voxelPos, 0).bgr;	// reflectionTex
			color = texelFetch(reflectionGrid, voxelPos, 0).rgb;	// reflectionLitTex
		}
	}
	else if (grid == 3)	// SHCoeffs
	{
		vec3 offset = (position) * (inverseFineGridCellSize);	// CAMERA
		float squaredDist = dot(offset, offset);
		if(squaredDist <= (15.0f * 15.0f))
		{
			ivec3 voxelPos = ivec3(offset) + ivec3(16);
			color = texelFetch(reflectionGrid, voxelPos, 0).rgb;
		}
	}
	else
	{
		// find for the current pixel best voxel representation
		uint gridRes = 0;
		vec3 offset = (position) * inverseFineGridCellSize;	// CAMERA
		float squaredDist = dot(offset, offset);
		if(squaredDist > (15.0f * 15.0f))
		{
			offset = (position) * inverseCoarseGridCellSize;	// CAMERA
			squaredDist = dot(offset, offset);
			gridRes = (squaredDist <= (15.0f * 15.0f)) ? 1 : 2;
		}

		// if voxel could be retrieved, get color
		if(gridRes < 2)
		{
			// get index of current voxel
			ivec3 voxelPos = ivec3(16, 16, 16) + ivec3(offset);
			int gridIndex = GetGridIndex(voxelPos);

			// get voxel
			Voxel voxel;
			if(gridRes == 0)
				voxel = fineGridBuffer[gridIndex];
			else
				voxel = coarseGridBuffer[gridIndex];

			// decode color
			color = DecodeColor(voxel.colorOcclusionMask);
		}
	}
	result = vec4(pow(color, vec3(1.0f/2.2f)), 1.0);
}
