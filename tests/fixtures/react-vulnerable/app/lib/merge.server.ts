export function deepMerge(target: Record<string, any>, source: Record<string, any>) {
  for (const key in source) {
    if (source[key] && typeof source[key] === "object") {
      target[key] = deepMerge(target[key] ?? {}, source[key]);
    } else {
      target[key] = source[key];
    }
  }
  return target;
}
