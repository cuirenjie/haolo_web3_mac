export function messageLocalPathContinuationLooksLikeProse(value) {
  return /[:\uFF1A]$/.test(value) || /[:\uFF1A][^\\/]*[\uFF0C\u3002\uFF01\uFF1F!?]/.test(value);
}
