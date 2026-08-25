export type ListMessage = {
  id: string;
  clientId?: string | null;
  roomSequence?: number | null;
  createdAt?: string | Date | null;
};

function clientKey(value: string | null | undefined) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function isSameMessage<T extends ListMessage>(left: T, right: T) {
  if (left.id === right.id) return true;
  const leftClientId = clientKey(left.clientId);
  const rightClientId = clientKey(right.clientId);
  return Boolean(leftClientId && leftClientId === rightClientId);
}

export function sortMessages<T extends ListMessage>(messages: T[]) {
  return [...messages].sort((left, right) => {
    const leftSeq = left.roomSequence;
    const rightSeq = right.roomSequence;
    if (leftSeq != null && rightSeq != null && leftSeq !== rightSeq) {
      return leftSeq - rightSeq;
    }
    if (leftSeq != null && rightSeq == null) return -1;
    if (leftSeq == null && rightSeq != null) return 1;
    return String(left.createdAt ?? "").localeCompare(String(right.createdAt ?? ""));
  });
}

export function mergeMessage<T extends ListMessage>(current: T[], incoming: T) {
  const index = current.findIndex((message) => isSameMessage(message, incoming));
  const next = [...current];
  if (index >= 0) {
    next[index] = { ...next[index], ...incoming };
  } else {
    next.push(incoming);
  }
  return sortMessages(next);
}
