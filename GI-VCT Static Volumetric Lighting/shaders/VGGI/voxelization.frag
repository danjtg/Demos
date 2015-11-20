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

in vec3 gPosition;
in vec2 gTexCoord;
in vec3 gNormal;
in vec4 gBBox;

uniform int voxelResolution;
uniform	sampler2D tex;
uniform float GAMMA;

layout(binding = 1, offset = 0) uniform atomic_uint fragmentCounter;

layout(binding = 0, rgba32f) writeonly uniform imageBuffer fragmentListPosition;
layout(binding = 1, rgba32f) writeonly uniform imageBuffer fragmentListColor;
layout(binding = 2, rgba32f) writeonly uniform imageBuffer fragmentListNormal;

vec4 convRGBA8ToVec4(uint val)
{
	return vec4(float((val & 0x000000FF)), float((val & 0x0000FF00) >> 8U), float((val & 0x00FF0000) >> 16U), float((val & 0xFF000000) >> 24U));
}

uint convVec4ToRGBA8(vec4 val)
{
	return (uint(val.w) & 0x000000FF) << 24U | (uint(val.z) & 0x000000FF) << 16U | (uint(val.y) & 0x000000FF) << 8U | (uint(val.x) & 0x000000FF);
}

void splat(in vec3 pos, in vec3 normal, in vec2 tc, in int fc)
{
	vec4 material = vec4(0);
	if (texCount == 0)
		material = diffuse;
	else
	{
		material.rgb = pow(texture(tex, tc).rgb, vec3(GAMMA));
		material.a = diffuse.a;
	}

	vec4 fragmentColor = vec4(material);
	vec4 fragmentNormal = vec4(normalize(normal) * 0.5 + 0.5, 1.0);
	vec4 fragmentCoord = vec4(pos * 0.5 + 0.5, 1.0);
	
	imageStore(fragmentListPosition, fc, fragmentCoord);
	imageStore(fragmentListColor, fc, fragmentColor);
	imageStore(fragmentListNormal, fc, fragmentNormal);
}


void main()
{
	vec2 bboxMin = floor((gBBox.xy * 0.5 + 0.5) * voxelResolution);
	vec2 bboxMax = ceil((gBBox.zw * 0.5 + 0.5) * voxelResolution);
	//if (all(greaterThanEqual(gl_FragCoord.xy, bboxMin)) && all(lessThanEqual(gl_FragCoord.xy, bboxMax)))
	if (all(greaterThanEqual(gPosition, vec3(-1))) && all(lessThanEqual(gPosition, vec3(1))))
	{
		int fragmentNumber = int(atomicCounterIncrement(fragmentCounter));
		splat(gPosition, gNormal, gTexCoord, fragmentNumber);
	}
	else discard;
}
