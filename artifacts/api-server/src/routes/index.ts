import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import usersRouter from "./users";
import pickupRequestsRouter from "./pickupRequests";
import factoryDemandsRouter from "./factoryDemands";
import loadOffersRouter from "./loadOffers";
import negotiationsRouter, { demandNegotiationStart } from "./negotiations";
import weatherRouter from "./weather";
import aiAnalyzeRouter from "./aiAnalyze";
import pushRouter from "./push";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/auth", authRouter);
router.use("/users", usersRouter);
router.use("/pickup-requests", pickupRequestsRouter);
router.use("/factory-demands", factoryDemandsRouter);
router.use("/factory-demands", demandNegotiationStart);
router.use("/load-offers", loadOffersRouter);
router.use("/negotiations", negotiationsRouter);
router.use("/weather", weatherRouter);
router.use("/ai", aiAnalyzeRouter);
router.use("/push", pushRouter);

export default router;
