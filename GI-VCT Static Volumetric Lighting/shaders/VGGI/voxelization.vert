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

out vec2 vTexCoord;
out vec3 vNormal;
out vec3 vPosition;

void main()
{
    vTexCoord = texCoord;
    vNormal = normal;
	vPosition = (model * vec4(position, 1.0f)).xyz;
}
