import React from "react";
import "./AgonyTracker.css";
import agonyImg from './assets/Stone_of_Agony_OoT.webp';
import gregImg from './assets/OoT_Green_Rupee_Model-2248945142.png';

interface AgonyTrackerProps {
  agony: number | string;
  agonyTotal: number | string;
  greg: number | string;
  gregTotal: number | string;
  showGreg?: boolean;
  checks: number | string;
  checksTotal: number | string;
  percent: number | string;
}

const AgonyTracker: React.FC<AgonyTrackerProps> = ({
  agony,
  agonyTotal,
  greg,
  gregTotal,
  showGreg = false,
  checks,
  checksTotal,
  percent,
}) => (
  <div className={`tracker-card${showGreg ? ' tracker-card--with-greg' : ''}`}>
      <img
        className="tracker-item-image"
        src={agonyImg}
        alt="Agony"
      />
    <div className="tracker-section">
      <div className="tracker-label">Agony</div>
      <div className="tracker-value">{agony}/{agonyTotal}</div>
    </div>
    {showGreg && (
      <>
        <img
          className="tracker-item-image"
          src={gregImg}
          alt="Greg"
        />
        <div className="tracker-section">
          <div className="tracker-label">Greg</div>
          <div className="tracker-value">{greg}/{gregTotal}</div>
        </div>
      </>
    )}
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
