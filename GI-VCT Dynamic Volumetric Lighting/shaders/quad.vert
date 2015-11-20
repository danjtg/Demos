
#version 430

const vec2 data[4] = vec2[]
(
  vec2(-1.0f,  1.0f),
  vec2(-1.0f, -1.0f),
  vec2( 1.0f,  1.0f),
  vec2( 1.0f, -1.0f)
);

out vec2 UV;

void main()
{
	gl_Position = vec4(data[gl_VertexID], 0.0f, 1.0f);
	UV = (data[gl_VertexID] + vec2(1,1)) / 2.0;
}
