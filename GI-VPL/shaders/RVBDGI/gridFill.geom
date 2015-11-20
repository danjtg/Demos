
#version 430

layout(triangles, invocations = 1) in;
layout(triangle_strip, max_vertices = 3) out;

layout (std140) uniform Matrices
{
	mat4 projViewModelMatrix;
	mat4 viewModel;
	mat4 view;
	mat3 normalMatrix;
	mat4 model;
	mat4 projection;
};

in vec2 T[];
in vec3 N[];
in vec3 P[];

out vec2 TexCoords;
out vec3 Normal;
out vec3 Position;

out vec4 bBox;
out mat3 inverseSwizzleMatrix;

uniform float pixelSize;

void expandTriangle(inout vec4 screenPos[3])
{
	/*vec2 side0N = normalize(screenPos[1].xy - screenPos[0].xy);
	vec2 side1N = normalize(screenPos[2].xy - screenPos[1].xy);
	vec2 side2N = normalize(screenPos[0].xy - screenPos[2].xy);
    
	screenPos[0].xy = screenPos[0].xy + normalize(-side0N + side2N) * pixelSize;
	screenPos[1].xy = screenPos[1].xy + normalize(side0N - side1N) * pixelSize;
	screenPos[2].xy = screenPos[2].xy + normalize(side1N - side2N) * pixelSize;*/

	vec2 edge[3];
	edge[0] = screenPos[1].xy - screenPos[0].xy;
	edge[1] = screenPos[2].xy - screenPos[1].xy;
	edge[2] = screenPos[0].xy - screenPos[2].xy;
    
	vec2 edgeNormal[3];
	edgeNormal[0] = normalize(edge[0]);
	edgeNormal[1] = normalize(edge[1]);
	edgeNormal[2] = normalize(edge[2]);
	edgeNormal[0] = vec2(-edgeNormal[0].y, edgeNormal[0].x);
	edgeNormal[1] = vec2(-edgeNormal[1].y, edgeNormal[1].x);
	edgeNormal[2] = vec2(-edgeNormal[2].y, edgeNormal[2].x);
    
    // If triangle is back facing, flip it's edge normals so triangle does not shrink.
    vec3 a = normalize(screenPos[1].xyz - screenPos[0].xyz);
	vec3 b = normalize(screenPos[2].xyz - screenPos[0].xyz);
	vec3 clipSpaceNormal = cross(a, b);
    if (clipSpaceNormal.z < 0.0)
    {
        edgeNormal[0] *= -1.0;
        edgeNormal[1] *= -1.0;
        edgeNormal[2] *= -1.0;
    }
    
	vec3 edgeDist;
	edgeDist.x = dot(edgeNormal[0], screenPos[0].xy);
	edgeDist.y = dot(edgeNormal[1], screenPos[1].xy);
	edgeDist.z = dot(edgeNormal[2], screenPos[2].xy);
    
	screenPos[0].xy = screenPos[0].xy - pixelSize * (edge[2] / dot(edge[2], edgeNormal[0]) + edge[0] / dot(edge[0], edgeNormal[2]));
	screenPos[1].xy = screenPos[1].xy - pixelSize * (edge[0] / dot(edge[0], edgeNormal[1]) + edge[1] / dot(edge[1], edgeNormal[0]));
	screenPos[2].xy = screenPos[2].xy - pixelSize * (edge[1] / dot(edge[1], edgeNormal[2]) + edge[2] / dot(edge[2], edgeNormal[1]));
}

const vec3 viewDirections[3] = vec3[]
(
	vec3(0.0f, 0.0f, -1.0f), // back to front
	vec3(-1.0f, 0.0f, 0.0f), // right to left
	vec3(0.0f, -1.0f, 0.0f)  // top to down 
); 

uint GetViewIndex(in vec3 normal)
{
	mat3 directionMatrix;
	directionMatrix[0] = -viewDirections[0];
	directionMatrix[1] = -viewDirections[1];
	directionMatrix[2] = -viewDirections[2];
	vec3 dotProducts = abs(normal * directionMatrix);
	float maximum = max(max(dotProducts.x, dotProducts.y), dotProducts.z);
	uint index;
	if(maximum == dotProducts.x)
		index = 0;
	else if(maximum == dotProducts.y)
		index = 1;
	else 
		index = 2;
	return index;
}

void main()
{
	vec3 faceNormal = normalize(N[0] + N[1] + N[2]);

	// Get view, at which the current triangle is most visible, in order to achieve highest
	// possible rasterization of the primitive.
	uint viewIndex = GetViewIndex(faceNormal);

	mat3 swizzleMatrix;
	if (viewIndex == 1)
	{
		swizzleMatrix = mat3(vec3(0.0, 0.0, 1.0),
							 vec3(0.0, 1.0, 0.0),
							 vec3(1.0, 0.0, 0.0));
	}
	else if (viewIndex == 2)
	{
		swizzleMatrix = mat3(vec3(1.0, 0.0, 0.0),
						 	 vec3(0.0, 0.0, 1.0),
							 vec3(0.0, 1.0, 0.0));
	}
	else
	{
		swizzleMatrix = mat3(vec3(1.0, 0.0, 0.0),
							 vec3(0.0, 1.0, 0.0),
							 vec3(0.0, 0.0, 1.0));
	}

	vec4 screenPos[3];
	screenPos[0] = projection * vec4(swizzleMatrix * P[0], 1.0);
	screenPos[1] = projection * vec4(swizzleMatrix * P[1], 1.0);
	screenPos[2] = projection * vec4(swizzleMatrix * P[2], 1.0);
    
	//screenPos[0] /= screenPos[0].w;
	//screenPos[1] /= screenPos[1].w;
	//screenPos[2] /= screenPos[2].w;

	// Bloat triangle in normalized device space with the texel size of the currently bound 
	// render-target. In this way pixels, which would have been discarded due to the low 
	// resolution of the currently bound render-target, will still be rasterized. 
	vec2 side0N = normalize(screenPos[1].xy-screenPos[0].xy);
	vec2 side1N = normalize(screenPos[2].xy-screenPos[1].xy);
	vec2 side2N = normalize(screenPos[0].xy-screenPos[2].xy);

	screenPos[0].xy += normalize(-side0N + side2N) * pixelSize;
	screenPos[1].xy += normalize(side0N - side1N) * pixelSize;
	screenPos[2].xy += normalize(side1N - side2N) * pixelSize;

	for(uint j = 0; j < 3; j++)
	{
		Position = P[j];
		TexCoords = T[j];
		Normal = N[j];
		gl_Position = screenPos[j];
		EmitVertex();
	}

	EndPrimitive();

	// Calculate swizzle matrix based on eye space normal's dominant direction.
	/*vec3 eyeSpaceV1 = normalize(P[1] - P[0]);
	vec3 eyeSpaceV2 = normalize(P[2] - P[0]);
	vec3 eyeSpaceNormal = abs(cross(eyeSpaceV1, eyeSpaceV2));
	
	float dominantAxis = max(eyeSpaceNormal.x, max(eyeSpaceNormal.y, eyeSpaceNormal.z));
	
	mat3 swizzleMatrix;
	if (dominantAxis == eyeSpaceNormal.x)
	{
		swizzleMatrix = mat3(vec3(0.0, 0.0, 1.0),
							 vec3(0.0, 1.0, 0.0),
							 vec3(1.0, 0.0, 0.0));
	}
	else if (dominantAxis == eyeSpaceNormal.y)
	{
		swizzleMatrix = mat3(vec3(1.0, 0.0, 0.0),
						 	 vec3(0.0, 0.0, 1.0),
							 vec3(0.0, 1.0, 0.0));
	}
	else
	{
		swizzleMatrix = mat3(vec3(1.0, 0.0, 0.0),
							 vec3(0.0, 1.0, 0.0),
							 vec3(0.0, 0.0, 1.0));
	}
	
	// Pass inverse of swizzle matrix to fragment shader.
	inverseSwizzleMatrix = inverse(swizzleMatrix);
	
	// Calculate screen coordinates for triangle.
	vec4 screenPos[3];
	screenPos[0] = projection * vec4(swizzleMatrix * P[0], 1.0);
	screenPos[1] = projection * vec4(swizzleMatrix * P[1], 1.0);
	screenPos[2] = projection * vec4(swizzleMatrix * P[2], 1.0);
    
	screenPos[0] /= screenPos[0].w;
	screenPos[1] /= screenPos[1].w;
	screenPos[2] /= screenPos[2].w;
	
	// Calculate screen space bounding box to be used for clipping in the fragment shader.
	bBox.xy = min(screenPos[0].xy, min(screenPos[1].xy, screenPos[2].xy));
	bBox.zw = max(screenPos[0].xy, max(screenPos[1].xy, screenPos[2].xy));
	bBox.xy -= vec2(pixelSize);
	bBox.zw += vec2(pixelSize);
	
	// Expand triangle for conservative rasterization.
	expandTriangle(screenPos);
	
	// Output triangle.
	Position = P[0];
    TexCoords = T[0];
    Normal = N[0];
	gl_Position = screenPos[0];
	EmitVertex();
	
	Position = P[1];
    TexCoords = T[1];
    Normal = N[1];
	gl_Position = screenPos[1];
	EmitVertex();
	
	Position = P[2];
    TexCoords = T[2];
    Normal = N[2];
	gl_Position = screenPos[2];
	EmitVertex();
	
	EndPrimitive();*/
}
