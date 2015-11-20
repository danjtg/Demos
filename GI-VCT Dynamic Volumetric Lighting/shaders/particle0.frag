#version 430

layout(binding = 0, r32ui) coherent volatile uniform uimage3D voxelGrid;

uniform int voxelResolution;

in vec4 worldPos;
layout (location = 2) out vec4 color;

void main()
{
	vec3 texPos = worldPos.xyz * 0.5 + 0.5;
	imageAtomicAdd(voxelGrid, ivec3(texPos * voxelResolution), 1);
	//imageStore(voxelGrid, ivec3(texPos * voxelResolution), uvec4(1));
	color = vec4(0.2, 0.2, 0.2, 1.0);
}
