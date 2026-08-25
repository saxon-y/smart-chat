export type AgentAvatar = {
  key: string;
  name: string;
  src: string;
};

export const AGENT_AVATARS: AgentAvatar[] = [
  { key: "aurora", name: "极光", src: "/agent-avatars/aurora.svg" },
  { key: "atlas", name: "星图", src: "/agent-avatars/atlas.svg" },
  { key: "moss", name: "苔原", src: "/agent-avatars/moss.svg" },
  { key: "ember", name: "余烬", src: "/agent-avatars/ember.svg" },
  { key: "luna", name: "月相", src: "/agent-avatars/luna.svg" },
  { key: "pixel", name: "像素", src: "/agent-avatars/pixel.svg" },
  { key: "sage", name: "鼠尾草", src: "/agent-avatars/sage.svg" },
  { key: "nebula", name: "星云", src: "/agent-avatars/nebula.svg" },
];

export const DEFAULT_AGENT_AVATAR = AGENT_AVATARS[1].src;

export const AGENT_COLORS = [
  "#3f7f86",
  "#6c63a8",
  "#6b8f71",
  "#c7664c",
  "#557aa3",
  "#b28a3e",
  "#8b6f8f",
  "#a45d79",
  "#4f8d87",
  "#7a6b5d",
  "#5d78a6",
  "#a66a58",
];
