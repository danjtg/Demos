
#version 430

#define NB_STEPS 15
#define G_SCATTERING 0.01f
#define PI 3.14159265359f

in vec2 UV;

layout(location = 0) out vec4 volumetric;

uniform vec3 cameraPos;
uniform vec3 lightPosition;
uniform vec4 lightColor;
uniform mat4 shadowMapProjection;
uniform mat4 shadowMapView;
uniform int voxelResolution;

layout(binding = 0) uniform sampler2D positions;
layout(binding = 1) uniform sampler2DShadow shadowMap;
layout(binding = 2) uniform sampler3D voxelGrid;

// 4x4 Dither pattern based on the Bayer Matrix
float ditherPattern[4][4] = 
{	{ 0.0f, 0.5f, 0.125f, 0.625f},
	{ 0.75f, 0.22f, 0.875f, 0.375f},
	{ 0.1875f, 0.6875f, 0.0625f, 0.5625},
	{ 0.9375f, 0.4375f, 0.8125f, 0.3125}};

// Mie scaterring approximated with Henyey-Greenstein phase function.
float ComputeScattering(float lightDotView, float gScatter)
{
	float result = 1.0f - gScatter;
	result *= result;
	result /= (4.0f * PI * pow(1.0f + (gScatter * gScatter) - (2.0f * gScatter) * lightDotView, 1.5f));
	
	return result;
}

void main()
{
	vec3 worldPos = texture(positions, UV).xyz;

	if(worldPos == vec3(0)) discard;

 	vec3 rayVector = worldPos - cameraPos;
	 
	float rayLength = 2.0;
	vec3 rayDirection = rayVector / rayLength;
	
	float stepLength = rayLength / NB_STEPS;
 
	vec3 stepVal = rayDirection * stepLength;

	// Dithered Ray Marching
	vec2 xy = gl_FragCoord.xy;
	int x = int(mod(xy.x, 4));
	int y = int(mod(xy.y, 4));

	vec3 currentPosition = cameraPos + stepVal * ditherPattern[x][y];
 
	vec3 accumFog = vec3(0.0f);
 
	for (int i = 0; i < NB_STEPS; i++)
	{
		vec4 shadowCoord = shadowMapProjection * shadowMapView * vec4(currentPosition, 1.0f);
		shadowCoord.xyz /= shadowCoord.w;
		shadowCoord.xyz = shadowCoord.xyz * 0.5 + 0.5;
		
		float shadowMapValue = texture(shadowMap, vec3(shadowCoord.xy, shadowCoord.z));
		
		if (shadowMapValue > 0)
		{
			vec3 texPos = currentPosition * 0.5 + 0.5;
			vec4 count = texture(voxelGrid, texPos)*255.0;
			float val = (uint(count.z) & 0x000000FF) << 16U | (uint(count.y) & 0x000000FF) << 8U | (uint(count.x) & 0x000000FF);
			
			float gScatter = 1.0 - clamp(val, 0.0, 1.0);

			//float gScatter = G_SCATTERING;

			accumFog += ComputeScattering(dot(rayVector, lightPosition), gScatter).xxx * lightColor.rgb * lightColor.a;
		}
		
		currentPosition += stepVal;
	}
	
	accumFog /= NB_STEPS;

	volumetric = vec4(clamp(2*accumFog, 0.0, 1.0), 1.0);

	/*
	vec3 position = texture(positions, UV).xyz;
	vec3 normal = texture(normals, UV).xyz;
	vec4 material = texture(materials, UV);

	if(position == vec3(0)) discard;	// maybe change the threshold
	
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

	*/
}
