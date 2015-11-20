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

in vec4 position;
in vec3 normal;
in vec2 texCoord;

out vec4 Coords;
out vec3 Normal;
out vec2 TexCoord;

void main()
{
	Coords = model * position;	// World Position
	Normal = normal;
	TexCoord = texCoord;
	gl_Position = projViewModelMatrix * position;
}
