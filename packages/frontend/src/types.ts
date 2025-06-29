export type Tool =
    | "rectangle"
    | "brush"
    | "erase"
    | "none"
    | "draw-freehand"
    | "draw-polygon"
    | "draw-line"
    | "edit-shapes";

export type Mode = "download" | "inference" | "label";

export interface Point {
    x: number;
    y: number;
}
