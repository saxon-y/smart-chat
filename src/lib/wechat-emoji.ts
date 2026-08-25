export type WechatEmoji = {
  name: string;
  code: string;
  src: string;
};

const FOLDER_BY_NAME: Record<string, string> = {
  发抖: "animal",
  猪头: "animal",
  跳跳: "animal",
  转圈: "animal",
  庆祝: "blessing",
  烟花: "blessing",
  爆竹: "blessing",
  發: "blessing",
  礼物: "blessing",
  福: "blessing",
  红包: "blessing",
  OK: "gesture",
  勾引: "gesture",
  合十: "gesture",
  弱: "gesture",
  强: "gesture",
  抱拳: "gesture",
  拥抱: "gesture",
  拳头: "gesture",
  握手: "gesture",
  胜利: "gesture",
  便便: "other",
  凋谢: "other",
  咖啡: "other",
  啤酒: "other",
  嘴唇: "other",
  太阳: "other",
  心碎: "other",
  月亮: "other",
  炸弹: "other",
  爱心: "other",
  玫瑰: "other",
  菜刀: "other",
  蛋糕: "other",
};

const EMOJI_NAMES = [
  "微笑", "撇嘴", "色", "发呆", "得意", "流泪", "害羞", "闭嘴", "睡", "大哭",
  "尴尬", "发怒", "调皮", "呲牙", "惊讶", "难过", "抓狂", "吐", "偷笑", "愉快",
  "白眼", "傲慢", "困", "惊恐", "憨笑", "悠闲", "咒骂", "疑问", "嘘", "晕",
  "衰", "骷髅", "敲打", "再见", "擦汗", "抠鼻", "鼓掌", "坏笑", "右哼哼", "鄙视",
  "委屈", "快哭了", "阴险", "亲亲", "可怜", "菜刀", "啤酒", "咖啡", "猪头", "玫瑰",
  "凋谢", "嘴唇", "爱心", "心碎", "蛋糕", "炸弹", "便便", "月亮", "太阳", "礼物",
  "拥抱", "强", "弱", "握手", "胜利", "抱拳", "勾引", "拳头", "OK", "跳跳",
  "发抖", "转圈",
  "囧", "笑脸", "生病", "脸红", "破涕为笑", "恐惧", "失望", "无语", "嘿哈", "捂脸",
  "机智", "皱眉", "耶", "吃瓜", "加油", "汗", "天啊", "Emm", "社会社会", "旺柴",
  "好的", "打脸", "哇", "翻白眼", "666", "让我看看", "叹气", "苦涩", "裂开", "奸笑",
  "合十", "庆祝", "红包", "發", "福", "烟花", "爆竹",
] as const;

function emojiSrc(name: string) {
  const folder = FOLDER_BY_NAME[name] ?? "face";
  return encodeURI(`/wechat-emoji/${folder}/${name}.png`);
}

export const WECHAT_EMOJI: WechatEmoji[] = EMOJI_NAMES.map((name) => ({
  name,
  code: `[${name}]`,
  src: emojiSrc(name),
}));

const EMOJI_BY_CODE = new Map(WECHAT_EMOJI.map((emoji) => [emoji.code, emoji]));

export function getWechatEmoji(token: string) {
  return EMOJI_BY_CODE.get(token);
}
