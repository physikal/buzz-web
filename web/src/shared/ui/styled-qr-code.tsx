import {
  useId,
  useMemo,
  type CSSProperties,
  type ReactNode,
  type SVGProps,
} from "react";
import { create } from "qrcode";

const CELL_SPACING_RATIO = 0.2;
const FINDER_PATTERN_SIZE = 7;
const QUIET_ZONE_SIZE = 4;
const MAX_CENTER_OBSCURED_RATIO = 0.1;
const CENTER_ICON_SIZE_RATIO = 0.8;
const QR_REVEAL_ROW_TRAVEL_MS = 250 / 1.3;

type StyledQrCodeProps = Omit<
  SVGProps<SVGSVGElement>,
  "children" | "height" | "title" | "width"
> & {
  animate?: boolean;
  backgroundColor?: string;
  centerImageSrc?: string;
  foregroundColor?: string;
  size?: number;
  title?: string;
  value: string;
};

function isFinderCell(row: number, column: number, matrixSize: number) {
  const top = row < FINDER_PATTERN_SIZE;
  const left = column < FINDER_PATTERN_SIZE;
  const right = column >= matrixSize - FINDER_PATTERN_SIZE;
  const bottom = row >= matrixSize - FINDER_PATTERN_SIZE;
  return (top && left) || (top && right) || (bottom && left);
}

function centerAreaSize(matrixSize: number) {
  const maxSide = Math.floor(
    Math.sqrt(matrixSize * matrixSize * MAX_CENTER_OBSCURED_RATIO),
  );
  return maxSide % 2 === 0 ? maxSide - 1 : maxSide;
}

function FinderPattern({
  backgroundColor,
  foregroundColor,
  x,
  y,
}: {
  backgroundColor: string;
  foregroundColor: string;
  x: number;
  y: number;
}) {
  return (
    <g data-qr-finder-pattern="">
      <rect
        fill={foregroundColor}
        height={FINDER_PATTERN_SIZE}
        rx={2}
        width={FINDER_PATTERN_SIZE}
        x={x}
        y={y}
      />
      <rect
        fill={backgroundColor}
        height={FINDER_PATTERN_SIZE - 2}
        rx={0.8}
        width={FINDER_PATTERN_SIZE - 2}
        x={x + 1}
        y={y + 1}
      />
      <rect
        fill={foregroundColor}
        height={FINDER_PATTERN_SIZE - 4}
        rx={0.4}
        width={FINDER_PATTERN_SIZE - 4}
        x={x + 2}
        y={y + 2}
      />
    </g>
  );
}

export function StyledQrCode({
  animate = false,
  backgroundColor = "#ffffff",
  centerImageSrc,
  foregroundColor = "#000000",
  size = 240,
  title = "QR code",
  value,
  ...svgProps
}: StyledQrCodeProps) {
  const clipId = `styled-qr-logo-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const matrix = useMemo(
    () => create(value, { errorCorrectionLevel: "M" }).modules,
    [value],
  );
  const viewBoxSize = matrix.size + QUIET_ZONE_SIZE * 2;
  const dataCellRadius = (1 - CELL_SPACING_RATIO) / 2;
  const logoAreaSize = centerImageSrc ? centerAreaSize(matrix.size) : 0;
  const logoAreaStart = (matrix.size - logoAreaSize) / 2;
  const logoAreaEnd = logoAreaStart + logoAreaSize;
  const logoSize = logoAreaSize * CENTER_ICON_SIZE_RATIO;
  const logoStart = (matrix.size - logoSize) / 2;
  const cells: ReactNode[] = [];

  for (let row = 0; row < matrix.size; row += 1) {
    for (let column = 0; column < matrix.size; column += 1) {
      const underLogo =
        centerImageSrc &&
        row >= logoAreaStart &&
        row < logoAreaEnd &&
        column >= logoAreaStart &&
        column < logoAreaEnd;
      if (
        !matrix.get(row, column) ||
        isFinderCell(row, column, matrix.size) ||
        underLogo
      ) {
        continue;
      }
      cells.push(
        <circle
          className={animate ? "buzz-qr-cell-reveal" : undefined}
          cx={column + 0.5}
          cy={row + 0.5}
          data-qr-cell-row={row}
          fill={foregroundColor}
          key={`${row}-${column}`}
          r={dataCellRadius}
          style={
            animate
              ? ({
                  "--buzz-qr-reveal-delay": `${Math.round(
                    (row / Math.max(matrix.size, 1)) * QR_REVEAL_ROW_TRAVEL_MS,
                  )}ms`,
                } as CSSProperties)
              : undefined
          }
        />,
      );
    }
  }

  return (
    <svg
      {...svgProps}
      aria-label={title}
      data-qr-matrix-size={matrix.size}
      height={size}
      role="img"
      viewBox={`${-QUIET_ZONE_SIZE} ${-QUIET_ZONE_SIZE} ${viewBoxSize} ${viewBoxSize}`}
      width={size}
      xmlns="http://www.w3.org/2000/svg"
    >
      <title>{title}</title>
      <rect
        fill={backgroundColor}
        height={viewBoxSize}
        width={viewBoxSize}
        x={-QUIET_ZONE_SIZE}
        y={-QUIET_ZONE_SIZE}
      />
      <g data-qr-data-cells="">{cells}</g>
      <FinderPattern
        backgroundColor={backgroundColor}
        foregroundColor={foregroundColor}
        x={0}
        y={0}
      />
      <FinderPattern
        backgroundColor={backgroundColor}
        foregroundColor={foregroundColor}
        x={matrix.size - FINDER_PATTERN_SIZE}
        y={0}
      />
      <FinderPattern
        backgroundColor={backgroundColor}
        foregroundColor={foregroundColor}
        x={0}
        y={matrix.size - FINDER_PATTERN_SIZE}
      />
      {centerImageSrc ? (
        <>
          <defs>
            <clipPath id={clipId}>
              <rect
                height={logoSize}
                rx={2}
                width={logoSize}
                x={logoStart}
                y={logoStart}
              />
            </clipPath>
          </defs>
          <rect
            fill={foregroundColor}
            height={logoSize}
            rx={2}
            width={logoSize}
            x={logoStart}
            y={logoStart}
          />
          <image
            clipPath={`url(#${clipId})`}
            height={logoSize}
            href={centerImageSrc}
            preserveAspectRatio="xMidYMid meet"
            width={logoSize}
            x={logoStart}
            y={logoStart}
          />
        </>
      ) : null}
    </svg>
  );
}
