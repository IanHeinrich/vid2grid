import "./style.css";
import { queryElements } from "./dom";
import { createAppState } from "./state";
import { initStatus } from "./ui/status";
import { initGallery } from "./ui/gallery";
import { initFramePlanPanel } from "./ui/framePlanPanel";
import { initGenerate } from "./ui/generate";
import { initSave } from "./ui/save";
import { initPreview } from "./ui/preview";

const els = queryElements();
const state = createAppState();

const status = initStatus(els);
const gallery = initGallery(els, state);
const framePlan = initFramePlanPanel(els, state, { status });
const generate = initGenerate(els, state, { status, gallery });
initSave(els, state, { status });
initPreview(els, state, { status, gallery, framePlan, generate });
