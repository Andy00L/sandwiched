import * as P2 from "papercraft/lib/paperkit-2d.js";
import { PALETTE } from "../table/palette";

export const SHARE_CARD_WIDTH = 1200;
export const SHARE_CARD_HEIGHT = 630;

const PAGE = "#ebddbf";
const PHOTO = { x: 58, y: 74, width: 640, height: 470, border: 14, tiltRad: -0.03 };
const TEXT_LEFT = 752;
const TEXT_WIDTH = 392;
const STAMP = { x: 1020, y: 40, width: 120, height: 140 };
const TITLE_FONT = "44px Gambarino, Georgia, serif";
const LINE_FONT = "500 25px Sentient, Georgia, serif";
const SMALL_FONT = "400 17px Sentient, Georgia, serif";
const LABEL_FONT = "18px Gambarino, Georgia, serif";

export type ShareCardText = { title: string; line: string; tableAddress: string };

function wrapLines(context: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  return text.split(" ").reduce<string[]>((lines, word) => {
    const last = lines.at(-1);
    const joined = last === undefined ? word : `${last} ${word}`;
    if (last !== undefined && context.measureText(joined).width > maxWidth) return [...lines, word];
    return [...lines.slice(0, -1), joined];
  }, []);
}

function drawPhoto(context: CanvasRenderingContext2D, frame: HTMLCanvasElement | null): void {
  context.save();
  context.translate(PHOTO.x + PHOTO.width / 2, PHOTO.y + PHOTO.height / 2);
  context.rotate(PHOTO.tiltRad);
  context.shadowColor = P2.rgba(PALETTE.ink, 0.35);
  context.shadowBlur = 18;
  context.shadowOffsetX = 6;
  context.shadowOffsetY = 9;
  context.fillStyle = PALETTE.creamCore;
  context.fillRect(-PHOTO.width / 2, -PHOTO.height / 2, PHOTO.width, PHOTO.height);
  context.shadowColor = "transparent";
  const innerWidth = PHOTO.width - PHOTO.border * 2;
  const innerHeight = PHOTO.height - PHOTO.border * 2;
  if (frame !== null && frame.width > 0 && frame.height > 0) {
    const scale = Math.max(innerWidth / frame.width, innerHeight / frame.height);
    const sourceWidth = innerWidth / scale;
    const sourceHeight = innerHeight / scale;
    context.drawImage(frame, (frame.width - sourceWidth) / 2, (frame.height - sourceHeight) / 2, sourceWidth, sourceHeight, -innerWidth / 2, -innerHeight / 2, innerWidth, innerHeight);
  } else {
    context.fillStyle = PALETTE.groundLight;
    context.fillRect(-innerWidth / 2, -innerHeight / 2, innerWidth, innerHeight);
  }
  context.strokeStyle = P2.rgba(PALETTE.ink, 0.55);
  context.lineWidth = 1.5;
  context.strokeRect(-innerWidth / 2, -innerHeight / 2, innerWidth, innerHeight);
  context.restore();
}

function drawStamp(context: CanvasRenderingContext2D): void {
  const { x, y, width, height } = STAMP;
  const toothRadius = 5;
  context.save();
  context.fillStyle = PALETTE.creamCore;
  context.fillRect(x, y, width, height);
  context.globalCompositeOperation = "destination-out";
  for (let along = toothRadius; along < width; along += toothRadius * 2.4) {
    for (const edgeY of [y, y + height]) {
      context.beginPath();
      context.arc(x + along, edgeY, toothRadius, 0, Math.PI * 2);
      context.fill();
    }
  }
  for (let along = toothRadius; along < height; along += toothRadius * 2.4) {
    for (const edgeX of [x, x + width]) {
      context.beginPath();
      context.arc(edgeX, y + along, toothRadius, 0, Math.PI * 2);
      context.fill();
    }
  }
  context.globalCompositeOperation = "source-over";
  context.fillStyle = PALETTE.tomato;
  context.fillRect(x + 12, y + 12, width - 24, height - 24);
  const centreX = x + width / 2;
  const centreY = y + height / 2 - 4;
  context.fillStyle = PALETTE.whaleSkin;
  context.strokeStyle = PALETTE.ink;
  context.lineWidth = 2;
  context.beginPath();
  context.roundRect(centreX - 34, centreY - 30, 68, 54, 24);
  context.fill();
  context.stroke();
  context.fillStyle = PALETTE.whaleBelly;
  context.fillRect(centreX - 30, centreY + 6, 60, 14);
  context.fillStyle = PALETTE.creamCore;
  for (const eyeX of [-12, 12]) {
    context.beginPath();
    context.arc(centreX + eyeX, centreY - 8, 6, 0, Math.PI * 2);
    context.fill();
  }
  context.fillStyle = PALETTE.ink;
  for (const eyeX of [-11, 13]) {
    context.beginPath();
    context.arc(centreX + eyeX, centreY - 7, 2.6, 0, Math.PI * 2);
    context.fill();
  }
  context.fillStyle = PALETTE.suit;
  context.fillRect(centreX - 26, centreY + 24, 52, 18);
  context.fillStyle = PALETTE.tomato;
  context.fillRect(centreX - 3, centreY + 24, 6, 16);
  context.font = LABEL_FONT;
  context.fillStyle = PALETTE.creamCore;
  context.textAlign = "center";
  context.fillText("DEVNET", centreX, y + height - 20);
  context.restore();
  context.save();
  context.strokeStyle = P2.rgba(PALETTE.ink, 0.5);
  context.lineWidth = 2;
  for (let wave = 0; wave < 4; wave++) {
    context.beginPath();
    for (let along = 0; along <= 150; along += 6) {
      const waveY = y + 70 + wave * 14 + Math.sin(along / 11) * 4;
      if (along === 0) context.moveTo(x - 110 + along, waveY);
      else context.lineTo(x - 110 + along, waveY);
    }
    context.stroke();
  }
  context.restore();
}

function drawNeatline(context: CanvasRenderingContext2D): void {
  const random = P2.rng(41);
  context.save();
  context.strokeStyle = P2.rgba(PALETTE.ink, 0.8);
  context.lineWidth = 2;
  context.lineJoin = "round";
  const inset = 16;
  const corners: [number, number][] = [
    [inset, inset],
    [SHARE_CARD_WIDTH - inset, inset],
    [SHARE_CARD_WIDTH - inset, SHARE_CARD_HEIGHT - inset],
    [inset, SHARE_CARD_HEIGHT - inset],
  ];
  context.beginPath();
  corners.forEach(([cornerX, cornerY], index) => {
    const jitterX = cornerX + (random() - 0.5) * 2;
    const jitterY = cornerY + (random() - 0.5) * 2;
    if (index === 0) context.moveTo(jitterX, jitterY);
    else context.lineTo(jitterX, jitterY);
  });
  context.closePath();
  context.stroke();
  context.restore();
}

export function drawShareCard(frame: HTMLCanvasElement | null, text: ShareCardText): HTMLCanvasElement {
  const card = document.createElement("canvas");
  card.width = SHARE_CARD_WIDTH;
  card.height = SHARE_CARD_HEIGHT;
  const context = card.getContext("2d");
  if (context === null) return card;
  const tile = P2.paperSheet({ size: 384, color: PAGE, fibres: 0.7, mottle: 0.04 });
  context.fillStyle = context.createPattern(tile, "repeat") ?? PAGE;
  context.fillRect(0, 0, SHARE_CARD_WIDTH, SHARE_CARD_HEIGHT);
  drawNeatline(context);
  drawPhoto(context, frame);
  drawStamp(context);
  context.fillStyle = PALETTE.ink;
  context.textAlign = "left";
  context.textBaseline = "alphabetic";
  context.font = LABEL_FONT;
  context.fillText("S A N D W I C H", TEXT_LEFT, 230);
  context.font = TITLE_FONT;
  const titleLines = wrapLines(context, text.title, TEXT_WIDTH);
  titleLines.forEach((line, index) => context.fillText(line, TEXT_LEFT, 286 + index * 48));
  const lineTop = 286 + titleLines.length * 48 + 24;
  context.font = LINE_FONT;
  context.fillStyle = P2.rgba(PALETTE.ink, 0.9);
  wrapLines(context, text.line, TEXT_WIDTH).forEach((line, index) => context.fillText(line, TEXT_LEFT, lineTop + index * 34));
  context.font = SMALL_FONT;
  context.fillStyle = P2.rgba(PALETTE.ink, 0.8);
  context.fillText(`Table ${text.tableAddress.slice(0, 4)}…${text.tableAddress.slice(-4)} on Solana devnet`, TEXT_LEFT, SHARE_CARD_HEIGHT - 66);
  context.fillText("Every crumb was an on-chain transaction.", TEXT_LEFT, SHARE_CARD_HEIGHT - 40);
  return card;
}
