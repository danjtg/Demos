#version 330

layout (std140) uniform Matrices
{
	mat4 projectionMatrix;
	mat4 viewMatrix;
	mat4 modelMatrix;
	mat4 projViewModelMatrix;
	mat4 viewModelMatrix;
	mat3 normalMatrix;	
};

in vec4 position;
in vec4 texCoord;

out Data {
	vec4 texCoord;
} DataOut;

void main()
{
	DataOut.texCoord = texCoord;
	gl_Position = projViewModelMatrix * position ;
} 
