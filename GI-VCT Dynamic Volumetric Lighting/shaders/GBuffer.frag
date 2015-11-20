#version 430

layout (std140) uniform Material
{
	vec4 diffuse;
	vec4 ambient;
	vec4 specular;
	vec4 emissive;
	float shininess;
	int texCount;
};

in vec4 Coords;
in vec3 Normal;
in vec2 TexCoord;

layout (location = 0) out vec4 worldPosition;
layout (location = 1) out vec4 normal;
layout (location = 2) out vec4 material;

uniform	sampler2D diffuseTexture;
uniform float GAMMA;

void main()
{
    worldPosition = Coords;
    normal = vec4(normalize(Normal), 1.0);
	if (texCount == 0)
		material = diffuse;
	else
	{
		//material.rgb = texture(diffuseTexture, TexCoord).rgb;
		material.rgb = pow(texture(diffuseTexture, TexCoord).rgb, vec3(GAMMA));
		material.a = diffuse.a;
	}
}
