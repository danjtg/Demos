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

// Input vertex data
layout(location = 1) in vec4 velocity;
layout(location = 2) in float time;

out float newTime;
out vec4 worldPos;

uniform float globalTime;

void main()
{
	newTime = time;
	
	float deltaT = globalTime - newTime;

	vec4 newVertexPos = vec4(0.0, -0.35, 0.1, 1.0) + velocity * deltaT - vec4(0.0, -0.01, 0.0, 0.0) * deltaT * deltaT * 0.5;	// p(t) = p0 + v0 * t + 1/2 * a * t^2
	
	if(newVertexPos.y > 1.0)
		newTime = globalTime;
	
	worldPos = newVertexPos;
	gl_Position = projViewModelMatrix * newVertexPos;
}
