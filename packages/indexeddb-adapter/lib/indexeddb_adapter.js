/*global Ember*/
/*global DS*/
 
DS.IndexedDBAdapter = DS.Adapter.extend({
  databaseName: 'IDBAdapter',
  databaseVersion:1,
  databaseTables:{},
  db:null,
  /**
   * IndexedDB requires that the database is initialized and have a defined
   * schema. It's not like localStorage, where you just store things. You have
   * to define beforehand what Object Stores you want (e.g User, Post etc).
   *
   * @method init
   */
  init: function() {
    this._super();
    var db = new Dexie(this.get("databaseName"));
    db.version(this.get("databaseVersion")).stores(this.get("databaseTables"));
    db.open().catch(function(error){
      console.log("Error when openning IndexDB:"+error);
    });
    this.set("db",db);
  },

  
  /**
   * This methods is used by the store to retrieve one record by ID.
   *
   * @method serialize
   * @param {DS.Store} store
   * @param {DS.Model} type
   * @param {Object|String|Integer|null} id
   * @param {Object|null} opts
   */
  findRecord: function (store, type, id, opts) {
    var adapter = this;
    var allowRecursive = this.allowRecursive(opts,true);
    return this.get("db")[type.modelName.camelize()].get(id)
    .then(function(record){
      if(record){
        return adapter.loadIds(store,type,record);
      }else{
        return Ember.RSVP.reject("can not find "+type+" by id "+id);
      }
    }).then(function(record){
      if (allowRecursive) {
        return adapter.loadRelationships(store, type, record, opts&&opts.adapterOptions);
      } else {
          return Ember.RSVP.resolve(record);
      }
    }).then(function(records){
      return adapter.toJSONAPI(store,type,records);
    });
  },

  /**
   * Retrieves many records from the database.
   *
   * @method findMany
   * @private
   * @param {DS.Store} store
   * @param {DS.Model} type the model that we're retrieving
   * @param {Array} ids ids of the records we want to be returned.
   */
  findMany: function (store, type, ids, opts) {
    var adapter = this;
    var allowRecursive = this.allowRecursive(opts,true);
    return this.get("db")[type.modelName.camelize()].where("id").anyOf(ids).toArray()
    .then(function(records){
      return adapter.loadIdsForMany(store,type,records);
    }).then(function(records){
      if (allowRecursive) {
        return adapter.loadRelationshipsForMany(store,type, records, opts&&opts.adapterOptions);
      } else {
          return Ember.RSVP.resolve(records);
      }
    }).then(function(records){
      return adapter.toJSONAPI(store,type,records);
    });
  },

  /**
   * Retrieves many records from the database according to the query.
   *
   * For example, we could do:
   *
   *     store.findQuery('customer', {name: /rambo|braddock/})
   *
   * @method findQuery
   * @private
   * @param {DS.Store} store
   * @param {DS.Model} type the model
   * @param {Object} query object with fields we want to look for
   */
  query: function (store, type, query) {
    var adapter = this;
    return this.get("db")[type.modelName.camelize()].filter(function(value){
      for (var field in query) {
        if(query[field]!==value[field]){
          return false;
        }
      }
      return true;
    })
    .toArray()
    .then(function(records){
      return adapter.loadIdsForMany(store,type,records);
    }).then(function(records){
      return adapter.loadRelationshipsForMany(store, type, records);
    }).then(function(records){
      return adapter.toJSONAPI(store,type,records);
    });
  },


  /**
   * Returns all records of a given type.
   *
   * @method findAll
   * @private
   * @param {DS.Store} store
   * @param {DS.Model} type
   */
  findAll: function (store, type,sinceToken,opts) {
    var adapter = this;
    return this.get("db")[type.modelName.camelize()].toArray()
    .then(function(records){
      return adapter.loadIdsForMany(store,type,records);
    }).then(function(records){
      return adapter.loadRelationshipsForMany(store, type, records, opts&&opts.adapterOptions);
    }).then(function(records){
      return adapter.toJSONAPI(store,type,records);
    });
  },
  toJSONAPI: function(store,type, record){
    var adapter=this;
    var included=[];
    if(Ember.isArray(record)){
      return {data:record.map(function(single){return toJSONAPISingle(type,single,included);},this),included:included};
    }else{
      return {data:toJSONAPISingle(type,record,included),included:included};
    }
    function toJSONAPISingle(type,record,included){
      var data={id:record["id"],type:type.modelName,attributes:{},relationships:{}};
      var relationships=adapter.getRelationships(type);
      for(var field in record){
        if (record.hasOwnProperty(field)){
          if(field==="__included__"){
            if(record["__included__"]){
              Ember.$.merge(included,record["__included__"]);
            }
          }else if(relationships.indexOf(field)>=0){
            var relationData=toRelationshipData(type.typeForRelationship(field,store).modelName,record[field]);
            if(relationData.id || Ember.isArray(relationData)){
              data.relationships[field.dasherize()]={data:relationData};
            }
          }else{
            //temp fix as the outsystems is not handling null date time type normally
            var attribute=Ember.get(type,"attributes").get(field);
            if(attribute && attribute.type==="date" && record[field]==="00:00:00"){
              data.attributes[field.dasherize()] = null;
            }else{
              data.attributes[field.dasherize()] = record[field];
            }
          }
        }
      }
      return data;
    }
    function toRelationshipData(type,value){
      if(Ember.isArray(value)){
        return value.map(function(id){return {type:type,id:(id?id:null)}});
      }else{
        return {type:type,id:(value?value:null)};
      }
    }
  },


  
  /**
   * Creates a record in the database.
   *
   * For example,
   *
   * ```js
   * store.createRecord('user', {name: "Rambo"})
   * ```
   *
   * @method createRecord
   * @param {DS.Store} store
   * @param {DS.Model} type
   * @param {Object} record
   */
  createRecord: function (store, type, snapshot) {
    var adapter=this;
    var table=this.get("db")[type.modelName.camelize()];
    var serialized = this.serialize(snapshot,{includeId:!table.schema.primKey.auto});
    if(!serialized["data_status"]){
      serialized["data_status"]='n';
    }
    return table.add(serialized).then(function(){
      return adapter.loadRelationships(store,type,serialized);
    });
  },

  /**
   *
   * @method updateRecord
   * @param {DS.Store} store
   * @param {DS.Model} type
   * @param {Object} snapshot
   */
  updateRecord: function (store, type, snapshot) {
    var adapter=this;
    var table=this.get("db")[type.modelName.camelize()];
    var serialized = this.serialize(snapshot,{includeId:!table.schema.primKey.auto});
    if(serialized["data_status"]==='s'){
      serialized["data_status"]='u';
    }
    return table.put(serialized).then(function(){
      return Ember.RSVP.resolve(serialized);
    });
  },

  /**
   *
   * @method deleteRecord
   * @param {DS.Store} store
   * @param {DS.Model} type
   * @param {Object} snapshot
   */
  deleteRecord: function (store, type, snapshot) {
    if(snapshot.attr("data_status")!=="s" && snapshot.attr("data_status")!=="u"){
      return this.get("db")[type.modelName.camelize()].delete(snapshot.id).then(function(){
        return Ember.RSVP.resolve(serialized);
      });
    }else{
      var adapter=this;
      var table=this.get("db")[type.modelName.camelize()];
      var serialized = this.serialize(snapshot,{includeId:!table.schema.primKey.auto});
      serialized["data_status"]="d";
      return table.put(serialized).then(function(){
        return Ember.RSVP.resolve(serialized);
      });
    }
  },

  /**
   * Generates a random number. You will usually want to implement UUID in your
   * app and redefine this method.
   *
   * @method generateIdForRecord
   * @private
   */
  previousGeneratedId:1,
  generateIdForRecord: function() {
    var date = Date.now();
    if (date <= this.previousGeneratedId) {
        date = ++this.previousGeneratedId;
    } else {
        this.previousGeneratedId = date;
    }
    return date;
  },
  loadIdsForMany: function(store, type, records){
    var relationshipNames = Ember.get(type, 'relationshipNames').hasMany;
    var adapter = this,
        recordsWithHasManyIds = [],
        promises = [],
        promise;
    records.forEach(function(record){
      promise = adapter.loadIds(store,type, record)
          .then(function(recordWithHasManyIds) {
            recordsWithHasManyIds.push(recordWithHasManyIds);
            return Ember.RSVP.resolve();
          });
      promises.push(promise);
    });    
    
    return Ember.RSVP.all(promises).then(function() {
        return Ember.RSVP.resolve(recordsWithHasManyIds);
    });
  },
  loadIds: function(store, type, record){
    var adapter=this;
    var relationshipNames = Ember.get(type, 'relationshipNames').hasMany;
    var relationshipsPromises=[];
    var tableName,columnName,promise;
    relationshipNames.forEach(function(relationshipName){
      tableName=adapter.relationshipProperties(type, relationshipName).type.camelize();
      columnName=type.modelName.camelize();
      promise= adapter.get("db")[tableName].where(columnName).equals(record.id).toArray().then(function(gameTiers){
        record[relationshipName]=gameTiers.map(function(gameTier){ return gameTier.id;});
        return Ember.RSVP.resolve(record);
        });
      relationshipsPromises.push(promise);
    });

    return Ember.RSVP.all(relationshipsPromises).then(function() {
      return Ember.RSVP.resolve(record);
    });
  },
  loadRelationshipsForMany: function(store, type, records, options) {
    var adapter = this,
        recordsWithRelationships = [],
        promises = [],
        promise;
    records.forEach(function(record){
      promise = adapter.loadRelationships(store,type, record, options)
          .then(function(recordWithRelationships) {
            recordsWithRelationships.push(recordWithRelationships);
            return Ember.RSVP.resolve();
          });
      promises.push(promise);
    });    
    
    return Ember.RSVP.all(promises).then(function() {
        return Ember.RSVP.resolve(recordsWithRelationships);
    });
  },

  loadRelationships: function(store, type, record,options) {
    var relationships=this.getRelationships(type,options);
    var adapter = this;
    var resultJSON = {},
        relationshipPromises = [];
    relationships.forEach(function(relationName) {
      var relationModel = type.typeForRelationship(relationName,store),
          relationEmbeddedId = record[relationName],
          relationProp  = adapter.relationshipProperties(type, relationName),
          relationType  = relationProp.kind,
          promise=null, embedPromise;
      var opts = {allowRecursive: false};

      if(relationType == 'hasMany' && relationEmbeddedId && relationEmbeddedId.length>0){
          promise = adapter.findMany(store, relationModel, relationEmbeddedId, opts);
      }else if ((relationType === 'belongsTo' || relationType === 'hasOne') && relationEmbeddedId) {
          promise = adapter.findRecord(store, relationModel, relationEmbeddedId, opts);
      }else if(!relationEmbeddedId){
        record[relationName]=null;
      } 

      if(promise){
        embedPromise=promise.then(function(relationRecord) {
          return Ember.RSVP.resolve(adapter.addEmbeddedPayload(record, relationName, relationRecord));
          });
        relationshipPromises.push(embedPromise);
      }
    });
    return Ember.RSVP.all(relationshipPromises).then(function() {
        return Ember.RSVP.resolve(record);
      });
  },

  addEmbeddedPayload: function(payload, relationshipName, relationshipRecord) {
    payload['__included__'] = payload['__included__']||[];
    if (relationshipRecord && relationshipRecord.data && relationshipRecord.data.id){
      payload['__included__'].push(relationshipRecord.data);
    }else if(relationshipRecord && relationshipRecord.data && relationshipRecord.data.length && relationshipRecord.data.isEvery("id")) {
        Ember.$.merge(payload['__included__'],relationshipRecord.data );
    }
    return payload;
  },


  relationshipProperties: function(type, relationName) {
    var relationships = Ember.get(type, 'relationshipsByName');
    if (relationName) {
      return relationships.get(relationName);
    } else {
      return relationships;
    }
  },

  willDestroy:function(){
    this.get("db").close();
  },
  allowRecursive:function(opts,isRecursive){
    if (opts && typeof opts.allowRecursive !== 'undefined') {
      return opts.allowRecursive||false;
    }else{
      return isRecursive||false;
    }
  },
  getRelationships:function(type,opts){
    var preloadFields=opts && opts.preload && Ember.isArray(opts.preload) && opts.preload ||[];
    var relationshipNames=Ember.get(type,"relationshipNames");
    relationshipNames=relationshipNames.belongsTo.concat(relationshipNames.hasMany);
    var relationshipsByName=Ember.get(type,"relationshipsByName");
    return relationshipNames.filter(function(relationshipName){
      return relationshipsByName.get(relationshipName).options && !relationshipsByName.get(relationshipName).options.async
        ||preloadFields.indexOf(relationshipName);
    });
  }
});