/** 猜数字 1A2B 核心（纯函数） */

/** 生成 4 位不重复数字（可含 0，首位不为 0） */
export function generateSecret(rng: () => number = Math.random): string {
  const digits = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
  const first = digits.splice(Math.floor(rng() * digits.length), 1)[0];
  digits.push('0');
  const rest: string[] = [];
  for (let i = 0; i < 3; i++) {
    rest.push(digits.splice(Math.floor(rng() * digits.length), 1)[0]);
  }
  return first + rest.join('');
}

export function isValidGuess(guess: string): boolean {
  return /^\d{4}$/.test(guess) && new Set(guess).size === 4;
}

/** 计算几 A 几 B：A = 数字和位置都对；B = 数字对位置错 */
export function judge(secret: string, guess: string): { a: number; b: number } {
  let a = 0, b = 0;
  const secretRest: string[] = [];
  const guessRest: string[] = [];
  for (let i = 0; i < 4; i++) {
    if (secret[i] === guess[i]) a++;
    else { secretRest.push(secret[i]); guessRest.push(guess[i]); }
  }
  for (const g of guessRest) {
    const idx = secretRest.indexOf(g);
    if (idx !== -1) { b++; secretRest.splice(idx, 1); }
  }
  return { a, b };
}
