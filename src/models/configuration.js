import { overlayTypes } from './products';
import { globes } from './globes';
import utils from '../utils/utils';
import { atom } from 'jotai';

const DEFAULT_CONFIG = 'current/wind/surface/level/orthographic';

const configuration = utils.parse(
  window.location.hash.substring(1) || DEFAULT_CONFIG,
  globes,
  overlayTypes
);

export const configurationAtom = atom(configuration);
