#version 430

layout(triangles, invocations = 1) in;
layout(triangle_strip, max_vertices = 3) out;

in vec2 vTexCoord[];
in vec3 vNormal[];
in vec3 vPosition[];

out vec3 gPosition;
out vec2 gTexCoord;
out vec3 gNormal;

out vec4 gBBox;

layout (std140) uniform Matrices
{
	mat4 projViewModelMatrix;
	mat4 viewModel;
	mat4 view;
	mat3 normalMatrix;
	mat4 model;
	mat4 projection;
};

uniform float pixelDiagonal;

void expandTriangle(inout vec4 screenPos[3])
{
	vec2 side0N = normalize(screenPos[1].xy - screenPos[0].xy);
	vec2 side1N = normalize(screenPos[2].xy - screenPos[1].xy);
	vec2 side2N = normalize(screenPos[0].xy - screenPos[2].xy);
	screenPos[0].xy = screenPos[0].xy + normalize(-side0N+side2N)*pixelDiagonal;
	screenPos[1].xy = screenPos[1].xy + normalize(side0N-side1N)*pixelDiagonal;
	screenPos[2].xy = screenPos[2].xy + normalize(side1N-side2N)*pixelDiagonal;
}

void main()
{
	// Calculate swizzle matrix based on eye space normal's dominant direction.
	vec3 eyeSpaceV1 = normalize(vPosition[1] - vPosition[0]);
	vec3 eyeSpaceV2 = normalize(vPosition[2] - vPosition[0]);
	vec3 eyeSpaceNormal = abs(cross(eyeSpaceV1, eyeSpaceV2));

	float dominantAxis = max(eyeSpaceNormal.x, max(eyeSpaceNormal.y, eyeSpaceNormal.z));

	// Calculate screen coordinates for triangle.
	vec4 screenPos[3];
	if (dominantAxis == eyeSpaceNormal.z)
	{
		screenPos[0] = projection * vec4(vPosition[0].xyz, 1.0);
		screenPos[1] = projection * vec4(vPosition[1].xyz, 1.0);
		screenPos[2] = projection * vec4(vPosition[2].xyz, 1.0);
	}
	else if (dominantAxis == eyeSpaceNormal.y)
	{
		screenPos[0] = projection * vec4(vPosition[0].xzy, 1.0);
		screenPos[1] = projection * vec4(vPosition[1].xzy, 1.0);
		screenPos[2] = projection * vec4(vPosition[2].xzy, 1.0);
	}
	else if (dominantAxis == eyeSpaceNormal.x)
	{
		screenPos[0] = projection * vec4(vPosition[0].zyx, 1.0);
		screenPos[1] = projection * vec4(vPosition[1].zyx, 1.0);
		screenPos[2] = projection * vec4(vPosition[2].zyx, 1.0);
	}
	
	// Calculate screen space bounding box to be used for clipping in the fragment shader.
	gBBox.xy = min(screenPos[0].xy, min(screenPos[1].xy, screenPos[2].xy));
	gBBox.zw = max(screenPos[0].xy, max(screenPos[1].xy, screenPos[2].xy));
	gBBox.xy -= vec2(pixelDiagonal);
	gBBox.zw += vec2(pixelDiagonal);
	
	// Expand triangle for conservative rasterization.
	expandTriangle(screenPos);
	
	// Output triangle.
	gPosition = vPosition[0];
    gTexCoord = vTexCoord[0];
    gNormal = vNormal[0];
	gl_Position = screenPos[0];
	EmitVertex();
	
    gPosition = vPosition[1];
	gTexCoord = vTexCoord[1];
    gNormal = vNormal[1];
	gl_Position = screenPos[1];
	EmitVertex();
	
    gPosition = vPosition[2];
	gTexCoord = vTexCoord[2];
    gNormal = vNormal[2];
	gl_Position = screenPos[2];
	EmitVertex();
	
	EndPrimitive();
}
