export interface ModeItem {
    id: string;
    isComingSoon: boolean;
}

export interface PracticeModeResponse {
    id: string;
    practiceModes: ModeItem[];
}