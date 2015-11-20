#version 400

uniform sampler2D texDay, texNight, texSpec, texClouds, moonDay, moonNight;
uniform float fsrender;

in vec3 teNormal;
in vec2 teTexCoord;
in vec3 teEye;
in vec3 teLightDir;

out vec4 colorOut;

// Earth with Day/Night Textures
void earthTexDayNight()
{

	vec4 dif, colorDay, colorNight;
	vec4 spec = vec4(0.0);
	float intSpec;
	
	vec3 n = normalize(teNormal);
	vec3 l = normalize(teLightDir);
	vec3 e = normalize(teEye);
	float intensity = max(dot(n,l), 0.0);
	
	if (intensity > 0.0)
	{
		vec3 h = normalize(l + e);
		float intSpec = max(dot(h,n), 0.0);
		spec = vec4(1.0) * pow(intSpec,100);
	}

	float gloss = texture(texSpec, teTexCoord).r;

	vec4 cD = texture(texDay, teTexCoord);
	vec4 cN = texture(texNight, teTexCoord);

	colorDay =  intensity * cD + gloss * spec;
	colorNight = cN;
	vec4 color;

	if (intensity > 0.1)
		color = colorDay;
	else if (intensity > 0.0) 
			// we are assuming a fixed intensity of 0.1 for mixing purposes
			color = mix(cN, 0.1f * cD + gloss * spec, intensity* 10.0f);
		else
			color = colorNight;
	colorOut = color;
}

// earth with Day/Night/Clouds Textures
void earthTexDayNightClouds()
{

	vec4 dif, colorDay, colorNight;
	vec4 spec = vec4(0.0);
	float intSpec;
	
	vec3 n = normalize(teNormal);
	vec3 l = normalize(teLightDir);
	vec3 e = normalize(teEye);
	float intensity = max(dot(n,l), 0.0);
	
	if (intensity > 0.0)
	{
		vec3 h = normalize(l + e);
		float intSpec = max(dot(h,n), 0.0);
		spec = vec4(1.0) * pow(intSpec,100);
	}

	float gloss = texture(texSpec, teTexCoord).r;
	float clouds = texture(texClouds, teTexCoord).r;

	vec4 cD = texture(texDay, teTexCoord);
	vec4 cN = texture(texNight, teTexCoord);

	colorDay = clouds * intensity + (1-clouds) * intensity * cD + gloss * spec;
	colorNight = (1-clouds) * cN;
	vec4 color;

	if (intensity > 0.1)
		color = colorDay;
	else if (intensity > 0.0) 
			// we are assuming a fixed intensity of 0.1 for mixing purposes
			color = mix(cN, clouds * 0.1f + (1-clouds) *0.1f * cD + gloss * spec, intensity* 10.0f);
		else
			color = colorNight;
	colorOut = color;
}

// Moon
void moonTex()
{

	vec4 dif, colorDay, colorNight;
	
	vec3 n = normalize(teNormal);
	vec3 l = normalize(teLightDir);
	vec3 e = normalize(teEye);
	float intensity = max(dot(n,l), 0.0);
	
	if (intensity > 0.0)
		vec3 h = normalize(l + e);

	vec4 cD = texture(moonDay, teTexCoord);
	vec4 cN = texture(moonNight, teTexCoord);

	colorDay =  intensity * cD;
	colorNight = cN;
	vec4 color;

	if (intensity > 0.1)
		color = colorDay;
	else if (intensity > 0.0) 
			// we are assuming a fixed intensity of 0.1 for mixing purposes
			color = mix(cN, 0.1f * cD, intensity* 10.0f);
		else
			color = colorNight;
	colorOut = color;
}


void main()
{
	if(fsrender == 1 || fsrender == 4)
		earthTexDayNight();
	else	if(fsrender == 2)
				earthTexDayNightClouds();
			else	if(fsrender == 3) 
						moonTex();
}
