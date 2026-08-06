declare module "qrcode" {
  type ErrorCorrectionLevel = "L" | "M" | "Q" | "H";
  type BitMatrix = {
    get(row: number, column: number): number;
    size: number;
  };
  export function create(
    value: string,
    options?: { errorCorrectionLevel?: ErrorCorrectionLevel },
  ): { modules: BitMatrix };
}
