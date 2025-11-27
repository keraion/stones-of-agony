import React from "react";
import "./AgonyTracker.css";
import agonyImg from './assets/Stone_of_Agony_OoT.webp';

interface AgonyTrackerProps {
  agony: number | string;
  agonyTotal: number | string;
  checks: number | string;
  checksTotal: number | string;
  percent: number | string;
}

const AgonyTracker: React.FC<AgonyTrackerProps> = ({ agony, agonyTotal, checks, checksTotal, percent }) => (
  <div className="tracker-card">
      <img
        src={agonyImg}
        alt="Agony"
      />
    <div className="tracker-section">
      <div className="tracker-label">Agony</div>
      <div className="tracker-value">{agony}/{agonyTotal}</div>
    </div>
    <div className="tracker-section">
      <div className="tracker-label">Checks</div>
      <div className="tracker-value">{checks}/{checksTotal}</div>
    </div>
    <div className="tracker-section">
      <div className="tracker-label">%</div>
      <div className="tracker-value">{percent}</div>
    </div>
  </div>
);

export default AgonyTracker;
