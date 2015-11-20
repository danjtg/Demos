
#version 430

#define PCF_NUM_SAMPLES 16

in vec2 UV;

layout(location = 0) out vec4 direct;

uniform vec3 cameraPos;
uniform vec3 lightPosition;
uniform vec4 lightColor;
uniform float shadowBias;
uniform float shadowFilterRadius;
uniform float inverseSMResolution;
uniform mat4 shadowMapProjection;
uniform mat4 shadowMapView;

layout(binding = 0) uniform sampler2D positions;
layout(binding = 1) uniform sampler2D normals;
layout(binding = 2) uniform sampler2D materials;
layout(binding = 3) uniform sampler2DShadow shadows;

// poisson disk samples
vec2 filterKernel[PCF_NUM_SAMPLES] =
{ 
	vec2(-0.94201624f, -0.39906216f),
	vec2(0.94558609f, -0.76890725f),
	vec2(-0.094184101f, -0.92938870f),
	vec2(0.34495938f, 0.29387760f),
	vec2(-0.91588581f, 0.45771432f),
	vec2(-0.81544232f, -0.87912464f),
	vec2(-0.38277543f, 0.27676845f),
	vec2(0.97484398f, 0.75648379f),
	vec2(0.44323325f, -0.97511554f),
	vec2(0.53742981f, -0.47373420f),
	vec2(-0.26496911f, -0.41893023f),
	vec2(0.79197514f, 0.19090188f),
	vec2(-0.24188840f, 0.99706507f),
	vec2(-0.81409955f, 0.91437590f),
	vec2(0.19984126f, 0.78641367f),
	vec2(0.14383161f, -0.14100790f)
};

void main()
{
	vec3 position = texture(positions, UV).xyz;
	vec3 normal = texture(normals, UV).xyz;
	vec4 material = texture(materials, UV);

	if(position == vec3(0)) discard;
	
	if(material.a == 0.0)
	{
		direct = vec4(material.rgb, 1.0);
		return;
	}

	vec3 V = normalize(cameraPos - position);
	vec3 N = normalize(normal);
	vec3 L = normalize(lightPosition);
	vec3 H = normalize(L + V);
	
	float NdotL = clamp(dot(N, L), 0.0, 1.0);
	float NdotH = clamp(dot(N, H), 0.0, 1.0);

	float p = 16.0;
	//float power = pow(NdotH, p);	// Blinn-Phong
	//float power = pow(NdotH, shininess);	// Blinn-Phong
	float power  = pow(NdotH, p) * (p + 2.0) / 8.0;	// energy conserving Blinn-Phong
	//float power = pow(NdotH, shininess) * (shininess + 2.0) / 8.0;	// energy conserving Blinn-Phong

	float specular = 0;
	if (NdotL > 0.0) specular = power;

	// compute shadow-term using 16x PCF in combination with hardware shadow filtering
	vec4 shadowCoord = shadowMapProjection * shadowMapView * vec4(position,1.0);
	shadowCoord.xyz /= shadowCoord.w;
    shadowCoord.xyz = shadowCoord.xyz * 0.5 + 0.5;
	
	float filterRadius = shadowFilterRadius * inverseSMResolution;
	float compareDepth = shadowCoord.z - shadowBias;
	float shadowTerm = 0.0f;

	for(int i = 0; i < PCF_NUM_SAMPLES; i++)
	{
		vec2 offset = filterKernel[i] * filterRadius;
		vec2 texCoords = shadowCoord.xy + offset;
		shadowTerm += texture(shadows, vec3(texCoords, compareDepth));
	}
	shadowTerm /= PCF_NUM_SAMPLES;
	
	direct = shadowTerm * ((NdotL * material * (vec4(lightColor.rgb, 1.0) * lightColor.a)) + (specular * material));
}
