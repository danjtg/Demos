
#version 430

const vec2 data[4] = vec2[]
(
  vec2(-1.0f,  1.0f),
  vec2(-1.0f, -1.0f),
  vec2( 1.0f,  1.0f),
  vec2( 1.0f, -1.0f)
);

out vec2 UV;
out int InstanceID;

void main()
{
	UV = data[gl_VertexID];
	InstanceID = gl_InstanceID;
}
