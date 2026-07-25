import type { CameraInspectionObservation } from '../camera-inspection-v1.ts';
import { BaseVisionSkill, type VisionSkillDraft } from './base-skill.ts';
import type {
  VisionSkillInput,
  VisionSkillObservation,
  VisionSkillRecommendation,
} from './contracts.ts';

function stateScore(value: string, positive: readonly string[], partial: readonly string[] = []): number | null {
  if (positive.includes(value)) return 1;
  if (partial.includes(value)) return 0.5;
  if (value === 'unknown' || value === 'not_visible') return null;
  return 0;
}

function inferredPower(observation: CameraInspectionObservation | null): 'on' | 'off' | 'unknown' {
  if (!observation) return 'unknown';
  const text = observation.description.toLowerCase();
  if (/\b(?:powered|switched|turned)\s+on\b|\b(?:lit|active)\s+(?:screen|display)\b/.test(text)) return 'on';
  if (/\b(?:powered|switched|turned)\s+off\b|\b(?:dark|blank)\s+(?:screen|display)\b/.test(text)) return 'off';
  return 'unknown';
}

export class OpeningReadinessSkill extends BaseVisionSkill {
  readonly name = 'opening_readiness' as const;

  protected evaluate(input: VisionSkillInput): VisionSkillDraft {
    const inspection = input.inspection;
    const pos = this.findInspectionObservation(input, ['pos', 'point of sale', 'till', 'register']);
    const posPower = inferredPower(pos);
    const counter = this.findInspectionObservation(input, ['counter']);
    const chairs = this.findInspectionObservation(input, ['chair', 'seating']);
    const cleanlinessKnown = inspection.operations.tables_state !== 'unknown'
      || inspection.operations.floor_state !== 'unknown';
    const cleanlinessReady = inspection.operations.tables_state === 'clean'
      && inspection.operations.floor_state === 'clear';
    const hazardCount = inspection.safety.hazards_detected.length;

    const observations: VisionSkillObservation[] = [
      inspection.scene.lighting_state === 'unknown'
        ? this.unknown('opening.lighting', 'Lighting state is not reliably visible.')
        : this.observed('opening.lighting', inspection.scene.lighting_state, `Lighting appears ${inspection.scene.lighting_state}.`, inspection.scene.confidence),
      posPower === 'unknown'
        ? this.unknown('opening.pos_power', pos ? 'A POS-related item is visible, but its power state is not reliable.' : 'The POS power state is not visible.')
        : this.observed('opening.pos_power', posPower, `The POS appears powered ${posPower}.`, pos?.confidence ?? 0),
      counter
        ? this.observed('opening.counter', 'visible', counter.description, counter.confidence)
        : this.unknown('opening.counter', 'Counter preparation is not reliably visible.'),
      inspection.operations.tables_state === 'unknown' || inspection.operations.tables_state === 'not_visible'
        ? this.unknown('opening.tables', 'Table readiness is not reliably visible.')
        : this.observed('opening.tables', inspection.operations.tables_state, `Tables appear ${inspection.operations.tables_state.replaceAll('_', ' ')}.`, inspection.operations.confidence),
      chairs
        ? this.observed('opening.chairs', 'visible', chairs.description, chairs.confidence)
        : this.unknown('opening.chairs', 'Chair placement is not reliably visible.'),
      inspection.operations.bar_state === 'unknown' || inspection.operations.bar_state === 'not_visible'
        ? this.unknown('opening.bar', 'Bar readiness is not reliably visible.')
        : this.observed('opening.bar', inspection.operations.bar_state, `Bar state appears ${inspection.operations.bar_state.replaceAll('_', ' ')}.`, inspection.operations.confidence),
      cleanlinessKnown
        ? this.observed('opening.cleanliness', cleanlinessReady ? 'ready' : 'needs_attention', cleanlinessReady ? 'Visible tables and floor appear ready.' : 'Visible tables or floor may need attention.', inspection.operations.confidence)
        : this.unknown('opening.cleanliness', 'Overall cleanliness is not sufficiently visible.'),
      this.observed('opening.hazards', hazardCount, hazardCount === 0 ? 'No visible hazards were reported in the inspection.' : `${hazardCount} visible hazard observation(s) require review.`, inspection.safety.confidence, hazardCount > 0 || inspection.safety.requires_human_review),
    ];
    const recommendations: VisionSkillRecommendation[] = [];
    if (inspection.scene.lighting_state !== 'on') recommendations.push(this.advisory('VERIFY_OPENING_LIGHTS', 'Verify opening lighting manually before service.'));
    if (posPower !== 'on') recommendations.push(this.advisory('VERIFY_POS_POWER', 'Confirm the POS is powered and ready; the image is not conclusive.'));
    if (!cleanlinessReady) recommendations.push(this.advisory('REVIEW_OPENING_CLEANLINESS', 'Review visible tables, counter, and floor before opening.'));
    if (hazardCount > 0 || inspection.safety.requires_human_review) recommendations.push(this.advisory('REVIEW_VISIBLE_HAZARDS', 'Have a manager review the visible hazard observations.'));

    const score = this.readinessScore([
      stateScore(inspection.scene.lighting_state, ['on'], ['mixed']),
      posPower === 'unknown' ? null : posPower === 'on' ? 1 : 0,
      stateScore(inspection.operations.tables_state, ['clean'], ['partially_clean']),
      stateScore(inspection.operations.bar_state, ['ready'], ['partially_ready']),
      stateScore(inspection.operations.floor_state, ['clear']),
      inspection.safety.confidence === 0 ? null : hazardCount === 0 ? 1 : 0,
    ]);
    return {
      confidence: this.meanConfidence(observations),
      observations,
      recommendations,
      warnings: score === null ? ['INSUFFICIENT_VISIBLE_EVIDENCE'] : [],
      metadata: {
        readinessScore: score,
        requiresHumanReview: inspection.safety.requires_human_review || hazardCount > 0,
        knownSignals: observations.filter((item) => item.state === 'observed').length,
        totalSignals: observations.length,
      },
    };
  }
}

export class ClosingReadinessSkill extends BaseVisionSkill {
  readonly name = 'closing_readiness' as const;

  protected evaluate(input: VisionSkillInput): VisionSkillDraft {
    const inspection = input.inspection;
    const equipment = this.findInspectionObservation(input, ['equipment', 'appliance', 'pos', 'monitor', 'screen']);
    const customersKnown = inspection.people.classification_confidence >= 0.6;
    const cleanlinessKnown = inspection.operations.tables_state !== 'unknown'
      || inspection.operations.floor_state !== 'unknown';
    const cleanlinessReady = inspection.operations.tables_state === 'clean'
      && inspection.operations.floor_state === 'clear';
    const observations: VisionSkillObservation[] = [
      inspection.scene.lighting_state === 'unknown'
        ? this.unknown('closing.lighting', 'Lighting state is not reliably visible.')
        : this.observed('closing.lighting', inspection.scene.lighting_state, `Lighting appears ${inspection.scene.lighting_state}.`, inspection.scene.confidence),
      customersKnown
        ? this.observed('closing.customers_remaining', inspection.people.customer_likely_count, `${inspection.people.customer_likely_count} person(s) are tentatively classified as customers in this single image.`, inspection.people.classification_confidence, inspection.people.customer_likely_count > 0)
        : this.unknown('closing.customers_remaining', 'The image does not support a reliable customer count.'),
      equipment
        ? this.observed('closing.equipment', 'visible', equipment.description, equipment.confidence)
        : this.unknown('closing.equipment', 'Equipment shutdown state is not reliably visible.'),
      cleanlinessKnown
        ? this.observed('closing.cleanliness', cleanlinessReady ? 'ready' : 'needs_attention', cleanlinessReady ? 'Visible tables and floor appear clean.' : 'Visible tables or floor may need attention.', inspection.operations.confidence)
        : this.unknown('closing.cleanliness', 'Closing cleanliness is not sufficiently visible.'),
      inspection.operations.entrance_state === 'unknown' || inspection.operations.entrance_state === 'not_visible'
        ? this.unknown('closing.doors', 'Door state is not reliably visible.')
        : this.observed('closing.doors', inspection.operations.entrance_state, `The visible entrance appears ${inspection.operations.entrance_state}.`, inspection.operations.confidence),
    ];
    const recommendations: VisionSkillRecommendation[] = [];
    if (inspection.scene.lighting_state !== 'off') recommendations.push(this.advisory('VERIFY_CLOSING_LIGHTS', 'Verify nonessential lights are off after closing.'));
    if (!customersKnown || inspection.people.customer_likely_count > 0) recommendations.push(this.advisory('VERIFY_VENUE_CLEAR', 'Confirm the venue is clear using human judgment.'));
    if (!cleanlinessReady) recommendations.push(this.advisory('REVIEW_CLOSING_CLEANLINESS', 'Review visible tables and floor before completing closing.'));
    if (inspection.operations.entrance_state !== 'closed') recommendations.push(this.advisory('VERIFY_DOORS_CLOSED', 'Confirm doors are closed and secured manually.'));
    const score = this.readinessScore([
      stateScore(inspection.scene.lighting_state, ['off'], ['mixed']),
      customersKnown ? inspection.people.customer_likely_count === 0 ? 1 : 0 : null,
      cleanlinessKnown ? cleanlinessReady ? 1 : 0 : null,
      stateScore(inspection.operations.entrance_state, ['closed']),
    ]);
    return {
      confidence: this.meanConfidence(observations),
      observations,
      recommendations,
      warnings: score === null ? ['INSUFFICIENT_VISIBLE_EVIDENCE'] : [],
      metadata: {
        readinessScore: score,
        requiresHumanReview: !customersKnown || inspection.people.customer_likely_count > 0,
        knownSignals: observations.filter((item) => item.state === 'observed').length,
        totalSignals: observations.length,
      },
    };
  }
}

export class CleanlinessSkill extends BaseVisionSkill {
  readonly name = 'cleanliness' as const;

  protected evaluate(input: VisionSkillInput): VisionSkillDraft {
    const inspection = input.inspection;
    const clutter = this.findInspectionObservation(input, ['clutter']);
    const trash = this.findInspectionObservation(input, ['trash', 'waste', 'garbage']);
    const counter = this.findInspectionObservation(input, ['counter']);
    const observations: VisionSkillObservation[] = [
      inspection.operations.tables_state === 'unknown' || inspection.operations.tables_state === 'not_visible'
        ? this.unknown('cleanliness.tables', 'Table cleanliness is not reliably visible.')
        : this.observed('cleanliness.tables', inspection.operations.tables_state, `Tables appear ${inspection.operations.tables_state.replaceAll('_', ' ')}.`, inspection.operations.confidence),
      counter
        ? this.observed('cleanliness.counter', 'visible', counter.description, counter.confidence)
        : this.unknown('cleanliness.counter', 'Counter cleanliness is not reliably visible.'),
      inspection.operations.floor_state === 'unknown' || inspection.operations.floor_state === 'not_visible'
        ? this.unknown('cleanliness.floor', 'Floor cleanliness is not reliably visible.')
        : this.observed('cleanliness.floor', inspection.operations.floor_state, `Floor appears ${inspection.operations.floor_state}.`, inspection.operations.confidence),
      clutter
        ? this.observed('cleanliness.clutter', 'visible', clutter.description, clutter.confidence)
        : this.unknown('cleanliness.clutter', 'Visible clutter cannot be reliably assessed.'),
      trash
        ? this.observed('cleanliness.trash', 'visible', trash.description, trash.confidence)
        : this.unknown('cleanliness.trash', 'Trash visibility cannot be reliably assessed.'),
    ];
    const recommendations: VisionSkillRecommendation[] = [];
    if (inspection.operations.tables_state !== 'clean') recommendations.push(this.advisory('REVIEW_TABLE_CLEANLINESS', 'Inspect and clean tables where needed.'));
    if (inspection.operations.floor_state !== 'clear') recommendations.push(this.advisory('REVIEW_FLOOR_CLEANLINESS', 'Inspect the visible floor and clear debris or clutter where needed.'));
    if (counter) recommendations.push(this.advisory('REVIEW_COUNTER_CLEANLINESS', 'Review the visible counter observation and clean if needed.'));
    if (clutter || trash) recommendations.push(this.advisory('REMOVE_VISIBLE_CLUTTER', 'Review and remove visible clutter or trash.'));
    if (recommendations.length === 0) recommendations.push(this.advisory('VERIFY_CLEANLINESS_MANUALLY', 'Confirm cleanliness manually before making an operational decision.'));
    return {
      confidence: this.meanConfidence(observations),
      observations,
      recommendations,
      warnings: observations.every((item) => item.state === 'unknown') ? ['INSUFFICIENT_VISIBLE_EVIDENCE'] : [],
      metadata: {
        scope: 'recommendations_only',
        knownSignals: observations.filter((item) => item.state === 'observed').length,
        totalSignals: observations.length,
      },
    };
  }
}

export class SafetySkill extends BaseVisionSkill {
  readonly name = 'safety' as const;

  protected evaluate(input: VisionSkillInput): VisionSkillDraft {
    const inspection = input.inspection;
    const trip = this.findInspectionObservation(input, ['trip hazard', 'tripping']);
    const blocked = this.findInspectionObservation(input, ['blocked path', 'blocked walkway', 'obstructed path']);
    const spill = this.findInspectionObservation(input, ['spill', 'wet floor']);
    const clutter = this.findInspectionObservation(input, ['unusual clutter', 'clutter']);
    const explicit = [
      ['safety.trip_hazard', trip, 'Trip hazards are not reliably visible.'],
      ['safety.blocked_path', blocked, 'Blocked paths are not reliably visible.'],
      ['safety.spill', spill, 'Visible spills are not reliably detectable.'],
      ['safety.unusual_clutter', clutter, 'Unusual clutter is not reliably visible.'],
    ] as const;
    const observations = explicit.map(([type, candidate, unknown]) => candidate
      ? this.observed(type, 'visible', candidate.description, candidate.confidence, true)
      : this.unknown(type, unknown));
    observations.push(this.observed(
      'safety.assessment',
      inspection.safety.hazards_detected.length,
      inspection.safety.hazards_detected.length === 0
        ? 'The validated inspection reported no visible hazards.'
        : `${inspection.safety.hazards_detected.length} visible hazard observation(s) were reported.`,
      inspection.safety.confidence,
      inspection.safety.requires_human_review || inspection.safety.hazards_detected.length > 0,
    ));
    for (const hazard of inspection.safety.hazards_detected) {
      observations.push(this.observed(
        'safety.reported_hazard',
        'visible',
        hazard.description,
        hazard.confidence,
        true,
      ));
    }
    const requiresHumanReview = inspection.safety.requires_human_review
      || inspection.safety.confidence < 0.6
      || observations.some((item) => item.state === 'observed');
    const recommendations = requiresHumanReview
      ? [this.advisory('HUMAN_SAFETY_REVIEW', 'Have an authorized person review the visible area before taking action.')]
      : [this.advisory('CONTINUE_ROUTINE_SAFETY_CHECK', 'Continue the normal human safety walkthrough; this image is advisory only.')];
    return {
      confidence: this.meanConfidence(observations),
      observations,
      recommendations,
      warnings: inspection.safety.confidence < 0.6 ? ['LOW_SAFETY_CONFIDENCE'] : [],
      metadata: {
        requiresHumanReview,
        reportedHazardCount: inspection.safety.hazards_detected.length,
        knownSignals: observations.filter((item) => item.state === 'observed').length,
        totalSignals: observations.length,
      },
    };
  }
}

export class EquipmentSkill extends BaseVisionSkill {
  readonly name = 'equipment' as const;

  protected evaluate(input: VisionSkillInput): VisionSkillDraft {
    const categories = [
      ['equipment.pos', ['pos', 'point of sale', 'till', 'register'], 'POS equipment is not reliably visible.'],
      ['equipment.screens', ['screen', 'display'], 'Screens are not reliably visible.'],
      ['equipment.monitors', ['monitor'], 'Monitors are not reliably visible.'],
      ['equipment.powered_devices', ['powered device', 'powered on', 'powered off'], 'Powered-device state is not reliably visible.'],
      ['equipment.appliances', ['appliance', 'refrigerator', 'fridge'], 'Visible appliances are not reliably identifiable.'],
    ] as const;
    const observations = categories.map(([type, terms, missing]) => {
      const candidate = this.findInspectionObservation(input, terms);
      return candidate
        ? this.observed(type, 'visible', candidate.description, candidate.confidence)
        : this.unknown(type, missing);
    });
    const recommendations: VisionSkillRecommendation[] = [];
    for (const observation of observations) {
      if (observation.state === 'unknown') {
        recommendations.push(this.advisory(
          `VERIFY_${observation.type.split('.')[1].toUpperCase()}`,
          `Verify ${observation.type.split('.')[1].replaceAll('_', ' ')} manually; the image is not conclusive.`,
        ));
      }
    }
    return {
      confidence: this.meanConfidence(observations),
      observations,
      recommendations,
      warnings: observations.every((item) => item.state === 'unknown') ? ['INSUFFICIENT_VISIBLE_EVIDENCE'] : [],
      metadata: {
        futureCapability: 'refrigeration_monitoring',
        knownSignals: observations.filter((item) => item.state === 'observed').length,
        totalSignals: observations.length,
      },
    };
  }
}
