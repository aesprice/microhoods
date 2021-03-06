var app = angular.module('microhoods.home', [])
.controller('map-controller', function($scope, $window, fbAuth) {
  //set increment for lat/lng granularity
  var block=.001;
  var conversion=1000
  var digits=3;

  //formats
  var highlight = {
    'color': '#03606B'
  };
  var defaultShape = {
    'color': '#DB5A55'
  };


  //place map on screen with correct proportions
  var height=$window.document.body.scrollHeight*.90;
  $window.document.getElementById("map").style.height=height.toString()+'px';
  var topPos=$window.document.body.scrollHeight*.06;
  $window.document.getElementById("map").style.top=topPos.toString()+'px';
  $window.document.getElementById("title").style.height=topPos.toString()+'px';
  $window.document.getElementById("personalMap").style.height=topPos.toString()+'px';
  $window.document.getElementById("communityMap").style.height=topPos.toString()+'px';

  //initialize map to SF
  var map = L.map('map', {zoomControl: false, attributionControl: false, maxBounds: [[37.7, -122.65], [37.85, -122.3]], minZoom: 12}).setView([37.789, -122.414], 14);

  L.tileLayer('http://api.tiles.mapbox.com/v3/austentalbot.gfeh9hg8/{z}/{x}/{y}.png', {maxZoom: 18}).addTo(map);

  //show current location every three seconds
  var here=undefined;
  map.locate({setView: true, maxZoom: 16});
  setInterval(function() {
    map.locate({setView: false, maxZoom: 16});
  }, 3000);

  var hereMarker=undefined;
  var onLocationFound = function (e) {
    var radius = 100;
    if (hereMarker===undefined) {
      hereMarker= new L.circle(e.latlng, radius, {color: '#03606B', weight: 2, opacity: .8});
      map.addLayer(hereMarker);
    } else {
      map.removeLayer(hereMarker);
      hereMarker=L.circle(e.latlng, radius, {color: '#03606B', weight: 2, opacity: .8});
      map.addLayer(hereMarker);
    }
    here=e.latlng;
  };

  map.on('locationfound', onLocationFound);

  //create tags for lat-lng coordinates surrounding an area
  //use strings because of precision/rounding issue
  var createTags=function() {
    var allTags={};
    for (var coordStr in labels) {
      console.log(labels[coordStr]);
      var coords=coordStr.split(',');
      coords[0]=parseInt(coords[0].replace(/\./g, ''));
      coords[1]=parseInt(coords[1].replace(/\./g, ''));

      // console.log(coords);
      for (var i=coords[0]-1; i<=coords[0]+1; i++) {
        var iStr=i.toString()
        for (var j=coords[1]-1; j<=coords[1]+1; j++) {
          var jStr=j.toString()
          var point=iStr.substring(0, iStr.length-3)+'.'+iStr.substring(iStr.length-3)+','+jStr.substring(0, jStr.length-3)+'.'+jStr.substring(jStr.length-3);
          allTags[point]=allTags[point] || [];
          allTags[point]=allTags[point].concat(labels[coordStr])
        }
      }
    }

    return allTags;
  }

  var wait=undefined;
  var labels={};
  $scope.tag='';

  //add tag to current location
  $scope.addHere=function(distance) {
    console.log('test');
    if ($scope.tag!=='') {
      var latlng=here.lat.toFixed(3) + ',' + here.lng.toFixed(3);

      labels[latlng] = labels[latlng] || [];
      console.dir(labels);
      labels[latlng].push($scope.tag);

      //add circle to show location and add circle marker with zero radius so we can bind a label that is always visible
      new L.circle(here, distance, {color: '#DB5A55', weight: 2, opacity: .8}).addTo(map);
      L.circleMarker(here, {color: '#DB5A55', opacity: 0}).setRadius(0).bindLabel($scope.tag, {noHide: true}).addTo(map);

      $scope.tag='';

      //wait five seconds to save in case other tags are added
      if (wait===undefined) {
        wait=setTimeout(function() {
          $scope.saveTags();
          wait=undefined;
        }, 5000);
      } else {
        clearTimeout(wait);
        wait=setTimeout(function() {
          $scope.saveTags();
          wait=undefined;
        }, 5000);
      }
    }
  };

  //search through all users' tags
  $scope.searchTags=function() {
    if ($scope.tag!=='') {

      var request = new XMLHttpRequest();
      request.open('POST', '/home/search', true);
      request.setRequestHeader('Content-Type', 'application/json');
      request.onload = function() {
        var tags = JSON.parse(request.responseText);
        for (var tag in tags) {
          var latlng=tags[tag].coordinates.split(',');
          latlng[0]=parseFloat(latlng[0]);
          latlng[1]=parseFloat(latlng[1]);

          markerlng=latlng[1]-(block/3);

          //insert circle
          new L.circle(latlng, 40, {color: '#DB5A55', weight: 2, opacity: .8}).addTo(map);
          //insert circle marker so we can always show label
          var marker=L.circleMarker([latlng[0], markerlng], {color: '#DB5A55', opacity: 0}).setRadius(0).bindLabel(tags[tag].tag, {noHide: true}).addTo(map);   
        }
      };
      request.send(JSON.stringify($scope.tag));
      $scope.tag='';
    }
  };

  //send tags to server to be saved in database with user information
  $scope.saveTags=function() {
    //get all tags from page
    var tags = {};
    tags.coordinates = createTags();
    tags.googleId = fbAuth.user.id;

    //send tags to server for saving
    var request = new XMLHttpRequest();
    request.open('POST', '/home', true);
    request.setRequestHeader('Content-Type', 'application/json');
    request.send(JSON.stringify(tags));

    labels={};
  };

  //switch to community view which shows top tag for each lat-lng coorinate
  $scope.communitySwitch = function() {
    //switch colors for two buttons
    document.getElementById("personalMap").style.background='#F28D7A';
    document.getElementById("communityMap").style.background='#DB5A55';

    //turn off current location finder
    map.off('locationfound', onLocationFound);

    //clear all layers except for map which should be first layer
    var mapLayer=false;
    for (var layer in map._layers) {
      if (mapLayer===true) {
        map.removeLayer(map._layers[layer]);
      } else {
        mapLayer=true;
      }
    }

    //get tags from server, filtered to most popular
    request = new XMLHttpRequest();
    request.open('GET', '/home', true);

    request.onload = function() {
      if (request.status >= 200 && request.status < 400){
        // repopulate map with most popular tags
        var allCoords = JSON.parse(request.responseText);
        console.log(allCoords);
        for (var coord in allCoords) {
          console.log(allCoords[coord]);
          var latlng=allCoords[coord].coordinates.split(',');
          latlng[0]=parseFloat(latlng[0]);
          latlng[1]=parseFloat(latlng[1]);

          markerlng=latlng[1]-(block/3);

          //insert circle
          new L.circle(latlng, 40, {color: '#DB5A55', weight: 2, opacity: .8}).addTo(map);
          //insert circle marker so we can always show label
          var marker=L.circleMarker([latlng[0], markerlng], {color: '#DB5A55', opacity: 0}).setRadius(0).bindLabel(allCoords[coord].tag, {noHide: true}).addTo(map);   
        }
      } 
    };
    request.onerror = function() {
      console.log('There was an error in sending your request.');
    };
    request.send();
  };

  $scope.personalSwitch=function() {
    //switch colors for two buttons
    document.getElementById("personalMap").style.background='#DB5A55';
    document.getElementById("communityMap").style.background='#F28D7A';

    //clear all layers except for map which should be first layer
    var mapLayer=false;
    for (var layer in map._layers) {
      if (mapLayer===true) {
        map.removeLayer(map._layers[layer]);
      } else {
        mapLayer=true;
      }
    }

    //turn on current location finder
    map.on('locationfound', onLocationFound);
    map.locate({setView: false, maxZoom: 16});

    //make request for user tags
    var request = new XMLHttpRequest();
    request.open('POST', '/home/user', true);
    request.setRequestHeader('Content-Type', 'application/json');
    request.onload = function() {
      var tags = JSON.parse(request.responseText);
      console.log(tags);
      for (var tag in tags) {
        var latlng=tags[tag].coordinates.split(',');
        latlng[0]=parseFloat(latlng[0]);
        latlng[1]=parseFloat(latlng[1]);

        markerlng=latlng[1]-(block/3);

        //insert circle
        new L.circle(latlng, 40, {color: '#DB5A55', weight: 2, opacity: .8}).addTo(map);
        //insert circle marker so we can always show label
        var marker=L.circleMarker([latlng[0], markerlng], {color: '#DB5A55', opacity: 0}).setRadius(0).bindLabel(tags[tag].tag, {noHide: true}).addTo(map);   
      }

    };
    request.send(JSON.stringify(fbAuth.user.id));
  };
});


