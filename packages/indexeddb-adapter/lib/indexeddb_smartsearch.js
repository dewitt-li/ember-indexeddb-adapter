/*global Ember*/
/*global DS*/
'use strict';

/**
 * SmartSearch allows the adapter to make queries that are broader and that
 * will, in most business cases, yield more relevant results.
 *
 * It has a drawback, though: less performant queries. It shouldn't be a problem
 * for smaller data stores.
 */
DS.IndexedDBSmartSearch = Ember.Object.extend({

});
