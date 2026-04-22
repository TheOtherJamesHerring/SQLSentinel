export interface Threshold {
  metricType: string;
  warningValue: number;
  criticalValue: number;
}

export interface EvaluatedAlert {
  alertType: string;
  severity: "critical" | "warning" | "info";
  title: string;
  message: string;
  metricValue: number;
  thresholdValue: number;
}

export function evaluateMetric(metricType: string, value: number, threshold: Threshold): EvaluatedAlert | null {
  if (value >= threshold.criticalValue) {
    return {
      alertType: `${metricType}_high`,
      severity: "critical",
      title: `${metricType.toUpperCase()} critical`,
      message: `${metricType} reached ${value.toFixed(2)} (${threshold.criticalValue} critical threshold).`,
      metricValue: value,
      thresholdValue: threshold.criticalValue
    };
  }

  if (value >= threshold.warningValue) {
    return {
      alertType: `${metricType}_high`,
      severity: "warning",
      title: `${metricType.toUpperCase()} warning`,
      message: `${metricType} reached ${value.toFixed(2)} (${threshold.warningValue} warning threshold).`,
      metricValue: value,
      thresholdValue: threshold.warningValue
    };
  }

  return null;
}
