DS.IndexedDBSerializer = DS.JSONAPISerializer.extend({
  
    /**
    @method serialize
    @param {DS.Snapshot} snapshot
    @param {Object} options
    @return {Object} json
  */
  serialize: function(snapshot, options) {
    var json = {};

    if (options && options.includeId) {
      var id = snapshot.id;

      if (id) {
        json[get(this, 'primaryKey')] = id;
      }
    }

    snapshot.eachAttribute(function(key, attribute) {
      this.serializeAttribute(snapshot, json, key, attribute);
    }, this);

    snapshot.eachRelationship(function(key, relationship) {
      if (relationship.kind === 'belongsTo') {
        this.serializeBelongsTo(snapshot, json, relationship);
      } else if (relationship.kind === 'hasMany') {
        this.serializeHasMany(snapshot, json, relationship);
      }
    }, this);

    return json;
  },


  /**
   @method serializeAttribute
   @param {DS.Snapshot} snapshot
   @param {Object} json
   @param {String} key
   @param {Object} attribute
  */
serializeAttribute: function(snapshot, json, key, attribute) {
    var type = attribute.type;

    if (this._canSerialize(key)) {
      var value = snapshot.attr(key);
      if (type) {
        var transform = this.transformFor(type);
        value = transform.serialize(value);
      }

      // if provided, use the mapping provided by `attrs` in
      // the serializer
      var payloadKey =  this._getMappedKey(key);

      if (payloadKey === key && this.keyForAttribute) {
        payloadKey = this.keyForAttribute(key, 'serialize');
      }

      json[payloadKey] = value;
    }
  },
  /**
   @method serializeBelongsTo
   @param {DS.Snapshot} snapshot
   @param {Object} json
   @param {Object} relationship
  */
 serializeBelongsTo: function(snapshot, json, relationship) {
    var key = relationship.key;

    if (this._canSerialize(key)) {
      var belongsToId = snapshot.belongsTo(key, { id: true });

      // if provided, use the mapping provided by `attrs` in
      // the serializer
      var payloadKey = this._getMappedKey(key);
      if (payloadKey === key && this.keyForRelationship) {
        payloadKey = this.keyForRelationship(key, "belongsTo", "serialize");
      }

      //Need to check whether the id is there for new&async records
      if (isNone(belongsToId)) {
        json[payloadKey] = null;
      } else {
        json[payloadKey] = belongsToId;
      }

      if (relationship.options.polymorphic) {
        this.serializePolymorphicType(snapshot, json, relationship);
      }
    }
  },

  /**
   @method serializeHasMany
   @param {DS.Snapshot} snapshot
   @param {Object} json
   @param {Object} relationship
  */
  serializeHasMany: function(snapshot, json, relationship) {
  }
});


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

  field:       null,
  queryString: null,
  record:      null,
  type:        null,

  /**
   * The entrypoint. It tries to match the current query field against the
   * record. See below each query explained.
   *
   * == Search ==
   *
   *     store.findQuery('person', {search: "rao"})
   *
   * This will will search for any field that has the string rao, such as
   * "Rambo".
   *
   * == Search ==
   *
   *     store.findQuery('person', {createdAt: "32 days ago"})
   *
   * Given `createdAt` field has a transform type `date`, it will returns only
   * records that match the 32nd day ago.
   *
   * If the fields doesn't have the `date` transform, nothing is queried.
   *
   * Besides `x days ago`, `today` and `yesterday` are also accepted.
   */
  isMatch: function() {
    var record      = this.get('record'),
        type        = this.get('type'),
        field       = this.get('field'),
        queryString = this.get('queryString'),
        fieldType   = this.fieldType(field),
        queryType;

    if (fieldType === "search") {
      queryType = 'searchField';
    } else if (fieldType === "date") {
      queryType = 'dateField';
    } else {
      queryType = 'regularField';
    }

    return this[queryType](type, record, field, queryString);
  },

  /**
   * Searches for string in any field. Consider the following query:
   *
   *     store.findQuery('person', {search: "rmbo"})
   *
   * This would match a field such as `{name: "Rambo"}`.
   *
   * @method searchField
   */
  searchField: function(type, record, field, queryString) {
    var isMatch;

    for (var queriedField in record) {
      var isSearchField = this.get('fieldSearchCriteria')(queriedField, type),
          fieldValue = record[queriedField];

      if (!isSearchField)
        continue;

      if (!queryString || queryString == " ") { return false; }

      if (Object.prototype.toString.call(queryString).match("RegExp")) {
        isMatch = isMatch || new RegExp(queryString).test(fieldValue);
      } else {
        isMatch = isMatch || (fieldValue === queryString);

        var str,
            strArray = [];

        for (var i = 0, len = queryString.length; i < len; i++) {
          strArray.push(queryString[i]);
        }

        str = new RegExp(strArray.join(".*"), "i");
        isMatch = isMatch || new RegExp(str).test(fieldValue);
      }
    }

    return isMatch;
  },

  dateField: function(type, record, field, queryString) {
    var rawValue = record[field],
        date = (new Date(Date.parse(rawValue))),
        targetDate = new Date(),
        match;

    var IsMatchToDate = function(targetDate) {
      var year   = targetDate.getFullYear(),
          month  = targetDate.getMonth(),
          day    = targetDate.getDate(),
          hour   = targetDate.getHours(),
          minute = targetDate.getMinutes();

      if (date.getFullYear() == year &&
          date.getMonth()    == month &&
          date.getDate()     == day) {
        return true;
      }
    }

    if (queryString === "today") {
      if (IsMatchToDate(targetDate)) {
        return true;
      }
    } else if (queryString === "yesterday") {
      targetDate.setDate(targetDate.getDate() - 1);
      if (IsMatchToDate(targetDate)) {
        return true;
      }
    } else if (match = queryString.match(/([0-9]{1,}) days ago/i)) {
      targetDate.setDate(targetDate.getDate() - match[1]);
      if (IsMatchToDate(targetDate)) {
        return true;
      }
    }

    return false;
  },

  regularField: function(type, record, field, queryString) {
    var queriedField = record[field];

    if (Object.prototype.toString.call(queryString).match("RegExp")) {
      return new RegExp(queryString).test(queriedField);
    } else {
      return (queriedField === queryString);
    }
  },

  fieldType: function(fieldName) {
    if (fieldName === "search") {
      return "search";
    } else {
      var type = this.get('type'),
          transform;

      type.eachTransformedAttribute(function(name, type) {
        if (name == fieldName) {
          transform = type;
        }
      });

      return transform;
    }
  }
});

/*global Ember*/
/*global DS*/
'use strict';

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
      return adapter.loadIds(store,type,record);
    }).then(function(record){
      if (allowRecursive) {
        return adapter.loadRelationships(type, record, opts&&opts.adapterOptions);
      } else {
          return Ember.RSVP.resolve(record);
      }
    }).then(function(records){
      return Ember.RSVP.resolve(adapter.toJSONAPI(type,records));
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
        return adapter.loadRelationshipsForMany(type, records, opts&&opts.adapterOptions);
      } else {
          return Ember.RSVP.resolve(records);
      }
    }).then(function(records){
      return Ember.RSVP.resolve(adapter.toJSONAPI(type,records));
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
    }).toArray()
    .then(function(records){
      return adapter.loadIdsForMany(store,type,records);
    })
    .then(function(records){
      return adapter.loadRelationshipsForMany(store, type, records);
    }).then(function(records){
      return Ember.RSVP.resolve(adapter.toJSONAPI(type,records));
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
      return Ember.RSVP.resolve(adapter.toJSONAPI(type,records));
    });
  },
  toJSONAPI: function(type, record){
    var included=[];
    if(Ember.isArray(record)){
      return {data:record.map(function(single){return this.toJSONAPI(type,single,included);},this),included:included};
    }else{
      return {data:toJSONAPISingle(type,record,included),included:included};
    }
    function toJSONAPISingle(type,record,included){
      var result={id:record[id],type:type.modelName,attributes:{},relationships:{}};
      var relationships=this.getRelationships(type);
      for(var field in record){
        if (record.hasOwnProperty(field)){
          if(field==="__included__"){
            if(record["__included__"]){
              for(var subType in record["__included__"]){
                if (record["__included__"].hasOwnProperty(subType)){
                  included.concat(record["__included__"][subType].map(function(subRecord){
                    return toJSONAPISingle(type.typeForRelationship(subType),subRecord,[]);});
                }
            }
          }else if(relationships.indexOf(field)>=0){
            result.relationships[field]={data:toRelationshipData(type.typeForRelationship(field).modelName,record[field])};
          }else{
            result.attributes[key] = record[field];
          }
        }
      }
      return result;
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
    return this.get("db")[type.modelName.camelize()].delete(snapshot.id).then(function(){
      return Ember.RSVP.resolve(serialized);
    });
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

      if(relationType == 'hasMany' && relationEmbeddedId.length>0){
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
    if ((relationshipRecord && relationshipRecord.id){
      relationshipRecord=[relationshipRecord];
    }
    if(relationshipRecord && relationshipRecord.length && relationshipRecord.isEvery("id"))) {
        payload['__included__'] = payload['__included__']||{};
        payload['__included__'][relationshipName] = relationshipRecord;
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