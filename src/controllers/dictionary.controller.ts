import { Request, Response, NextFunction } from "express";
import * as dictionaryService from "../services/dictionary.service";
import { sendSuccess } from "../utils/response.util";

export async function lookupWordController(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const { word } = req.query;
        const result = await dictionaryService.lookupWord(word as string);
        sendSuccess(res, "Word looked up successfully", result);
    } catch (err) {
        next(err);
    }
}