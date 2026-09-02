interface DOMMatrix2D {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

type AnyObj = Record<string, unknown>;

class Matrix2D implements DOMMatrix2D {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;

  constructor(
    init?: string | number[] | ArrayBufferView | AnyObj | DOMMatrix2D,
  ) {
    this.a = 1;
    this.b = 0;
    this.c = 0;
    this.d = 1;
    this.e = 0;
    this.f = 0;

    if (typeof init === 'string' || init === undefined || init === null) {
      return;
    }
    if (Array.isArray(init) || ArrayBuffer.isView(init)) {
      const m = Array.from(init as ArrayLike<number>);
      if (m.length === 6) {
        this.a = m[0];
        this.b = m[1];
        this.c = m[2];
        this.d = m[3];
        this.e = m[4];
        this.f = m[5];
      } else if (m.length === 16) {
        this.a = m[0];
        this.b = m[1];
        this.c = m[4];
        this.d = m[5];
        this.e = m[12];
        this.f = m[13];
      }
      return;
    }
    const obj = init as AnyObj;
    if (typeof obj.a === 'number') {
      this.a = obj.a;
      this.b = (obj.b as number) ?? 0;
      this.c = (obj.c as number) ?? 0;
      this.d = (obj.d as number) ?? 1;
      this.e = (obj.e as number) ?? 0;
      this.f = (obj.f as number) ?? 0;
    } else if (typeof obj.m11 === 'number') {
      this.a = obj.m11;
      this.b = (obj.m12 as number) ?? 0;
      this.c = (obj.m21 as number) ?? 0;
      this.d = (obj.m22 as number) ?? 1;
      this.e = (obj.m41 as number) ?? 0;
      this.f = (obj.m42 as number) ?? 0;
    }
  }

  translate(tx = 0, ty = 0): Matrix2D {
    return new Matrix2D({
      a: this.a,
      b: this.b,
      c: this.c,
      d: this.d,
      e: this.a * tx + this.c * ty + this.e,
      f: this.b * tx + this.d * ty + this.f,
    });
  }

  scale(sx = 1, sy = sx, _sz = 1, ox = 0, oy = 0): Matrix2D {
    void _sz;
    const e = this.a * (ox - sx * ox) + this.c * (oy - sy * oy) + this.e;
    const f = this.b * (ox - sx * ox) + this.d * (oy - sy * oy) + this.f;
    return new Matrix2D({
      a: this.a * sx,
      b: this.b * sy,
      c: this.c * sx,
      d: this.d * sy,
      e,
      f,
    });
  }

  multiply(other: DOMMatrix2D): Matrix2D {
    return new Matrix2D({
      a: this.a * other.a + this.c * other.b,
      b: this.b * other.a + this.d * other.b,
      c: this.a * other.c + this.c * other.d,
      d: this.b * other.c + this.d * other.d,
      e: this.a * other.e + this.c * other.f + this.e,
      f: this.b * other.e + this.d * other.f + this.f,
    });
  }

  invert(): Matrix2D {
    const det = this.a * this.d - this.b * this.c;
    if (det === 0) {
      return new Matrix2D({ a: 1, b: 0, c: 0, d: 1, e: -this.e, f: -this.f });
    }
    const s = 1 / det;
    return new Matrix2D({
      a: this.d * s,
      b: -this.b * s,
      c: -this.c * s,
      d: this.a * s,
      e: (this.c * this.f - this.d * this.e) * s,
      f: (this.b * this.e - this.a * this.f) * s,
    });
  }

  toJSON(): DOMMatrix2D {
    return {
      a: this.a,
      b: this.b,
      c: this.c,
      d: this.d,
      e: this.e,
      f: this.f,
    };
  }
}

class DOMPointShim {
  x: number;
  y: number;
  z: number;
  w: number;

  constructor(x = 0, y = 0, z = 0, w = 1) {
    this.x = x;
    this.y = y;
    this.z = z;
    this.w = w;
  }
}

class DOMRectShim {
  x: number;
  y: number;
  width: number;
  height: number;

  constructor(x = 0, y = 0, width = 0, height = 0) {
    this.x = x;
    this.y = y;
    this.width = width;
    this.height = height;
  }

  get top(): number {
    return this.y;
  }

  get left(): number {
    return this.x;
  }

  get right(): number {
    return this.x + this.width;
  }

  get bottom(): number {
    return this.y + this.height;
  }
}

const g = globalThis as unknown as AnyObj;

if (typeof g.DOMMatrix === 'undefined') {
  g.DOMMatrix = Matrix2D;
  g.DOMMatrixReadOnly = Matrix2D;
  (g.DOMMatrix as AnyObj).fromMatrix = (m: unknown) =>
    new Matrix2D(m as AnyObj);
  (g.DOMMatrix as AnyObj).fromFloat32Array = (arr: ArrayLike<number>) =>
    new Matrix2D(Array.from(arr));
  (g.DOMMatrix as AnyObj).fromFloat64Array = (arr: ArrayLike<number>) =>
    new Matrix2D(Array.from(arr));
}

if (typeof g.DOMPoint === 'undefined') {
  g.DOMPoint = DOMPointShim;
  g.DOMPointReadOnly = DOMPointShim;
}

if (typeof g.DOMRect === 'undefined') {
  g.DOMRect = DOMRectShim;
}

if (typeof g.Path2D === 'undefined') {
  g.Path2D = class Path2DShim {};
}

if (typeof g.ImageData === 'undefined') {
  g.ImageData = class ImageDataShim {
    data: ArrayBufferLike;
    width: number;
    height: number;

    constructor(data: ArrayBufferLike, width: number, height: number) {
      this.data = data;
      this.width = width;
      this.height = height;
    }
  };
}

export {};
