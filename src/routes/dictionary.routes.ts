import { Router } from "express";
import { verifyToken } from "../middlewares/auth.middleware";
import { lookupWordController } from "../controllers/dictionary.controller";

const router = Router();
router.use(verifyToken);

router.get("/lookup", lookupWordController);

export default router;