import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeDomain, checkTyposquatting } from '../server/services/urlMetadata.js';

test('analyzeDomain correctly recognizes reputable wire and news outlets', () => {
  const reuters = analyzeDomain('reuters.com');
  assert.equal(reuters.isReputable, true);
  assert.equal(reuters.category, 'reputable');

  const bbc = analyzeDomain('www.bbc.com');
  assert.equal(bbc.isReputable, true);
  assert.equal(bbc.category, 'reputable');

  const ap = analyzeDomain('apnews.com');
  assert.equal(ap.isReputable, true);
});

test('analyzeDomain flags known satire domains', () => {
  const onion = analyzeDomain('theonion.com');
  assert.equal(onion.isSatire, true);
  assert.equal(onion.category, 'satire');

  const babylon = analyzeDomain('babylonbee.com');
  assert.equal(babylon.isSatire, true);
});

test('checkTyposquatting detects deceptive mimic domains', () => {
  const bbcMimic = checkTyposquatting('bbc-news.co');
  assert.equal(bbcMimic.isTyposquat, true);
  assert.equal(bbcMimic.impersonatedBrand, 'bbc');

  const reutersMimic = checkTyposquatting('reuters-breaking.top');
  assert.equal(reutersMimic.isTyposquat, true);
  assert.equal(reutersMimic.impersonatedBrand, 'reuters');

  const legitimateBbc = checkTyposquatting('bbc.com');
  assert.equal(legitimateBbc.isTyposquat, false);

  const legitimateReuters = checkTyposquatting('reuters.com');
  assert.equal(legitimateReuters.isTyposquat, false);
});
