
#version 430

layout(triangles) in;
layout(triangle_strip, max_vertices = 3) out;

in vec2 UV[];
in int InstanceID[];

out vec4 position;
flat out uint rtIndex;

void main()
{
	for(uint i = 0; i < 3; i++)
	{
		position = vec4(UV[i], 0.0f, 1.0f);
		rtIndex = InstanceID[0]; // write 32 instances of primitive into 32 slices of 2D texture array
		gl_Position = position;
		EmitVertex();
	}
	EndPrimitive();
}
