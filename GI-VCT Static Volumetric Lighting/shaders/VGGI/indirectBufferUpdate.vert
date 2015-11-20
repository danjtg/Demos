#version 430

layout(binding = 1, offset = 0) uniform atomic_uint fragmentCounter;

layout(binding = 1, r32ui) writeonly uniform uimageBuffer indirectBuffer;

void main()
{
	uint count = atomicCounter(fragmentCounter);
	
    imageStore(indirectBuffer, 0, uvec4(count));	// vertex count
	imageStore(indirectBuffer, 1, uvec4(1));	// primitive count
}
