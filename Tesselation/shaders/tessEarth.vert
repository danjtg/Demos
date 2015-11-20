#version 400

in vec4 position;
in vec2 texCoord;
in vec3 normal;

out	vec3 vNormal;
out	vec2 vTexCoord;
out	vec4 vPosition;

// Simple Pass-trough to the Tesselation Control Shader
void main()
{
	vNormal = normal;
	vTexCoord = texCoord;
	vPosition = position; 
}
