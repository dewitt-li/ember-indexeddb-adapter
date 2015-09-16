/* jshint node: true */
'use strict';

module.exports = {
  name: 'ember-indexeddb-adapter',
  included: function(app) {
    this._super.included(app);

    app.import(app.bowerDirectory + '/dexie/dist/latest/Dexie.js');
  }
};
