import { DEFAULT_LANGUAGE, translate } from '../i18n.mjs';

export function destinationDescription(kind, language = DEFAULT_LANGUAGE) {
  return translate(language, `destination.${kind}`);
}

export const DESTINATION_DESCRIPTIONS = Object.freeze({
  posts: destinationDescription('posts'),
  categories: destinationDescription('categories'),
  tags: destinationDescription('tags')
});
