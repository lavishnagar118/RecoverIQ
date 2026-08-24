export class SeededRandom {
  private state: number;

  constructor(seed: number) {
    if (!Number.isInteger(seed) || seed <= 0) {
      throw new Error("Seed must be a positive integer");
    }

    this.state = seed % 2_147_483_647;

    if (this.state === 0) {
      this.state = 1;
    }
  }

  next(): number {
    this.state = (this.state * 48_271) % 2_147_483_647;
    return (this.state - 1) / 2_147_483_646;
  }

  nextInt(minimum: number, maximum: number): number {
    if (!Number.isInteger(minimum) || !Number.isInteger(maximum) || minimum > maximum) {
      throw new Error("Invalid integer range");
    }

    return Math.floor(this.next() * (maximum - minimum + 1)) + minimum;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) {
      throw new Error("Cannot pick from an empty collection");
    }

    return items[this.nextInt(0, items.length - 1)];
  }
}
