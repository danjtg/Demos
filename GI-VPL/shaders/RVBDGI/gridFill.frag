
#version 430

#define FINE_GRID 0
#define COARSE_GRID 1
#define REFLECTION_GRID 2

layout (std140) uniform Material
{
	vec4 diffuse;
	vec4 ambient;
	vec4 specular;
	vec4 emissive;
	float shininess;
	int texCount;
};

layout (std140) uniform Matrices
{
	mat4 projViewModelMatrix;
	mat4 viewModel;
	mat4 view;
	mat3 normalMatrix;
	mat4 model;
	mat4 projection;
};

in vec2 TexCoords;
in vec3 Normal;
in vec3 Position;

in vec4 bBox;
in mat3 inverseSwizzleMatrix;

layout(location = 0) out vec4 colorOut;

uniform	sampler2D tex;
uniform int grid;
uniform vec3 cameraPos;
uniform float inverseFineGridCellSize;
uniform float inverseCoarseGridCellSize;

struct Voxel
{
	uint colorOcclusionMask;
	uvec4 normalMasks;
};

layout(binding = 0, std430) buffer GridBuffer
{
	Voxel gridBuffer[];
};

layout(binding = 1, r32ui) coherent volatile uniform uimage3D gridReflection;

// normalized directions of 4 faces of a regular tetrahedron
const vec3 faceVectors[4] = vec3[]
(
	vec3(0.0f, -0.57735026f, 0.81649661f),
	vec3(0.0f, -0.57735026f, -0.81649661f),
	vec3(-0.81649661f, 0.57735026f, 0.0f),
	vec3(0.81649661f, 0.57735026f, 0.0f) 
);

uint GetNormalIndex(in vec3 normal, out float dotProduct)
{
	mat4x3 faceMatrix;
	faceMatrix[0] = faceVectors[0];
	faceMatrix[1] = faceVectors[1];
	faceMatrix[2] = faceVectors[2];
	faceMatrix[3] = faceVectors[3];   
	vec4 dotProducts = normal * faceMatrix;
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
	return index;
}

// Encode specified color (range 0.0f-1.0f), so that each channel is
// stored in 8 bits of an unsigned integer.
uint EncodeColor(in vec3 color)
{
	uvec3 iColor = uvec3(color * 255.0f);
	uint colorMask = (iColor.r << 16U) | (iColor.g << 8U) | iColor.b;
	return colorMask;
}

// Encode specified normal (normalized) into an unsigned integer. Each axis of
// the normal is encoded into 9 bits (1 for the sign/ 8 for the value).
uint EncodeNormal(in vec3 normal)
{
	ivec3 iNormal = ivec3(normal*255.0f);
	uvec3 iNormalSigns;
	iNormalSigns.x = (iNormal.x>>5) & 0x04000000;
	iNormalSigns.y = (iNormal.y>>14) & 0x00020000;
	iNormalSigns.z = (iNormal.z>>23) & 0x00000100;
	iNormal = abs(iNormal);
	uint normalMask = iNormalSigns.x | (iNormal.x<<18) | iNormalSigns.y | (iNormal.y<<9) | iNormalSigns.z | iNormal.z;
	return normalMask;
}

// get index into a 32x32x32 grid for the specified position
int GetGridIndex(in ivec3 position)
{
	return ((position.z * 1024) + (position.y * 32) + position.x);
}

// Instead of outputting the rasterized information into the bound render-target, it will be
// written into a 3D structured buffer. In this way dynamically a voxel-grid can be generated.
// Among the variety of DX11 buffers the RWStructuredBuffer has been chosen, because this is
// the only possibility to write out atomically information into multiple variables without
// having to use for each variable a separate buffer.
// However, for the reflection grid only 1 variable is used to store the color/ occlusion,
// thus here a 3D texture is used.
void main()
{
	/*int voxelResolution;
	if(grid == REFLECTION_GRID) voxelResolution = 512;
	else voxelResolution = 64;

	vec2 bboxMin = floor((bBox.xy * 0.5 + 0.5) * voxelResolution);
	vec2 bboxMax = ceil((bBox.zw * 0.5 + 0.5) * voxelResolution);

	if (all(greaterThanEqual(gl_FragCoord.xy, bboxMin)) && all(lessThanEqual(gl_FragCoord.xy, bboxMax)))*/
	{
		// get surface color
		vec3 base = texture(tex, TexCoords).rgb;

		// encode color in linear space into unsigned integer
		vec3 baseLinear = diffuse.rgb / 3.14159265359 * pow(base, vec3(2.2f));
		uint colorOcclusionMask = EncodeColor(baseLinear);

		// Since voxels are a simplified representation of the actual scene, high frequency information
		// gets lost. In order to amplify color bleeding in the final global illumination output, colors
		// with high difference in their color channels (called here contrast) are preferred. By writing
		// the contrast value (0-255) in the highest 8 bit of the color-mask, automatically colors with
		// high contrast will dominate, since we write the results with an InterlockedMax into the voxel-
		// grids. The contrast value is calculated in SRGB space.
		float contrast = length(base.rrg - base.gbb) / (sqrt(2.0f) + base.r + base.g + base.b);
		uint iContrast = uint(contrast * 127.0);
		colorOcclusionMask |= iContrast << 24U;

		// encode occlusion into highest bit
		colorOcclusionMask |= 1 << 31U;

		if(grid != REFLECTION_GRID)
		{
			// encode normal into unsigned integer
			vec3 N = normalize(Normal);
			uint normalMask = EncodeNormal(N);

			// Normals values also have to be carefully written into the voxels, since for example thin geometry
			// can have opposite normals in one single voxel. Therefore it is determined, to which face of a
			// tetrahedron the current normal is closest to. By writing the corresponding dotProduct value in the
			// highest 5 bit of the normal-mask, automatically the closest normal to the determined tetrahedron
			// face will be selected, since we write the results with an InterlockeMax into the voxel-grids.
			// According to the retrieved tetrahedron face the normals are written into the corresponding normal
			// channel of the voxel. Later on, when the voxels are illuminated, the closest normal to the light-
			// vector is chosen, so that the best illumination can be obtained.
			float dotProduct;
			uint normalIndex = GetNormalIndex(N, dotProduct);
			uint iDotProduct = uint(clamp(dotProduct, 0.0, 1.0) * 31.0f);
			normalMask |= iDotProduct<<27U;

			// get offset into the voxel-grid
			vec3 offset;
			if(grid == FINE_GRID)
				offset = (Position ) * inverseFineGridCellSize;	// CAMERA
			else
				offset = (Position ) * inverseCoarseGridCellSize;	// CAMERA
			
			// get position in the voxel-grid
			ivec3 voxelPos = ivec3(offset) + ivec3(16);

			// To avoid raise conditions between multiple threads, that write into the same location, atomic
			// functions have to be used. Only output voxels that are inside the boundaries of the grid.
			if((voxelPos.x > -1) && (voxelPos.x < 32) && (voxelPos.y > -1) && (voxelPos.y < 32) && (voxelPos.z > -1) && (voxelPos.z < 32))
			{
				// get index into the voxel-grid
				int gridIndex = GetGridIndex(voxelPos);

				// output color/ occlusion
				atomicMax(gridBuffer[gridIndex].colorOcclusionMask, colorOcclusionMask);

				// output normal according to normal index
				if(normalIndex == 0)
					atomicMax(gridBuffer[gridIndex].normalMasks.x, normalMask);
				if(normalIndex == 1)
					atomicMax(gridBuffer[gridIndex].normalMasks.y, normalMask);
				if(normalIndex == 2)
					atomicMax(gridBuffer[gridIndex].normalMasks.z, normalMask);
				if(normalIndex == 3)
					atomicMax(gridBuffer[gridIndex].normalMasks.w, normalMask);
			}
		}
		else
		{
			// get offset into the voxel-grid
			vec3 offset = (Position)*(inverseFineGridCellSize*8.0f);	// CAMERA

			// get position in the voxel-grid
			ivec3 voxelPos = ivec3(offset) + ivec3(128);
			
			// Write out colorOcclusionMask atomically to avoid raise conditions. Only output voxels that are inside the grid boundaries.
			if((voxelPos.x > -1) && (voxelPos.x < 256) && (voxelPos.y > -1) && (voxelPos.y < 256) && (voxelPos.z > -1) && (voxelPos.z < 256))
			{
				imageAtomicMax(gridReflection, voxelPos, colorOcclusionMask);
			}
		}
	}
	//else discard;
}
