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

in vec3 position;
in vec3 normal;
in vec2 texCoord;

out vec2 T;
out vec3 N;
out vec3 P;

void main()
{
    T = texCoord;
    N = normal;
	P = (model * vec4(position, 1.0f)).xyz;
}
