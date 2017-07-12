var app = require('express')();
var http = require('http').Server(app);
var io = require('socket.io')(http);

var SOCKET_LIST = {};
var PLAYER_LIST = {};
var ROOM_LIST = [];

app.set('port', (process.env.PORT || 2000));

app.get('/',function(req, res) {
    res.sendFile(__dirname + '/lobby.html');
});

app.get('/*', function(req, res) {
    var url = req.path.substring(1);
    for (var i = 0; i < ROOM_LIST.length; i++) {
        if (ROOM_LIST[i].id == url && ROOM_LIST[i].count < 4) {
            res.sendFile(__dirname + '/index.html');
            return;
        }
    }
    res.status(404).send('404: Room does not exist.');
});

var Player = function(id) {
    var self = {
        x : 125,
        y : 125,
        id : id,
        username : '',
        number : '' + Math.floor(10 * Math.random()),
        count : 0,
        color : '#FFFFFF',
        canMove : false,
        key : 'up',
        maxSpd : 1,
        room : 0,
    }
    self.updatePosition = function() {
        if (self.canMove == true) {
            if (self.key == 'right')
                self.x += self.maxSpd;
            if (self.key == 'left')
                self.x -= self.maxSpd;
            if (self.key == 'up')
                self.y -= self.maxSpd;
            if (self.key == 'down')
                self.y += self.maxSpd;
        }
    }
    return self;
}

var Room = function(id) {
    var self = {
        id : id,
        count : 0,
        winCount : 0,
        refresh : 0
    }
    return self;
}

io.on('connection', function(socket) {
 
    socket.on('disconnect',function(){
        if (PLAYER_LIST[socket.id] != null) {
            var player = PLAYER_LIST[socket.id];
            for (var i = 0; i < ROOM_LIST.length; i++) {
                if (player.room == ROOM_LIST[i].id) {
                    if (ROOM_LIST[i].count == 4) {
                        delete PLAYER_LIST[socket.id];
                        delete SOCKET_LIST[socket.id];
                        if (player.canMove)
                            ROOM_LIST[i].winCount++;
                        if (ROOM_LIST[i].winCount >= 3) {
                            var winner = getWinner(ROOM_LIST[i].id);
                            io.to(ROOM_LIST[i].id).emit('winner', {winner : winner.username, color : winner.color});
                            ROOM_LIST.splice(i, 1);
                        }
                        break;
                    }
                    ROOM_LIST[i].count--;
                    if (ROOM_LIST[i].count == 0)
                        ROOM_LIST.splice(i, 1);
                    io.to(player.room).emit('clearCanvas', {});
                    delete PLAYER_LIST[socket.id];
                    delete SOCKET_LIST[socket.id];
                    for (var i in PLAYER_LIST) {
                        if (PLAYER_LIST[i].room == player.room && player.count < PLAYER_LIST[i].count) {
                
                            PLAYER_LIST[i].count--;
                            getPosInRoom(PLAYER_LIST[i]);
                            getColor(PLAYER_LIST[i]);
                        }
                    }
                    io.to(player.room).emit('getUsers', {players : PLAYER_LIST});
                    break;
                }
            }
        }
    });
    
    socket.emit('getRooms', {rooms : ROOM_LIST});
    socket.on('updateRooms', function(data) {
        socket.emit('getRooms', {rooms : ROOM_LIST});
    });
    
    // listen for player movement
    socket.on('keyPress', function(data) {
        var player = PLAYER_LIST[socket.id];
        if (player.canMove == true) {
            player.key = data.inputID;
        }
    });
    
    // create a room
    socket.on('creation', function(data) {
        var room = Room(data.ROOM_ID);
        ROOM_LIST.push(room);
    });
    
    // join a room
    socket.on('joinRoom', function(data) {
        SOCKET_LIST[socket.id] = socket;
        socket.join(data.ROOM_ID);
        var player = Player(socket.id);
        player.room = data.ROOM_ID;
        player.username = data.USER_ID;
        PLAYER_LIST[socket.id] = player;
        
        for (var i = 0; i < ROOM_LIST.length; i++) {
            if (ROOM_LIST[i].id == data.ROOM_ID) {
                ROOM_LIST[i].count++;
                player.count = ROOM_LIST[i].count;
                getPosInRoom(player);
                getColor(player);
                if (ROOM_LIST[i].count == 4) {
                    for (var j in PLAYER_LIST) {
                        if (PLAYER_LIST[j].room == data.ROOM_ID) {
                            PLAYER_LIST[j].canMove = true;
                        }
                    }
                }
                break;
            }
        }
        io.to(player.room).emit('getUsers', {players : PLAYER_LIST});
    });
    
    // check if a room exists
    socket.on('checkRoom', function(data) {
        var exists = false;
        for (var i = 0; i < ROOM_LIST.length; i++) {
            if (ROOM_LIST[i].id == data.ROOM_ID && ROOM_LIST[i].count < 4) {
                exists = true;
                break;
            }
        }
        socket.emit('roomExists', {state : exists});
    });
    
    socket.on('crash', function(data) {
        var player = PLAYER_LIST[data.player];
        player.canMove = false;
        for (var i = 0; i < ROOM_LIST.length; i++) {
            if (player.room == ROOM_LIST[i].id) {
                ROOM_LIST[i].winCount++;
                if (ROOM_LIST[i].winCount >= 3) {
                    var winner = getWinner(ROOM_LIST[i].id);
                    io.to(ROOM_LIST[i].id).emit('winner', {winner : winner.username, color : winner.color});
                }
                break;
            }
        }
    });
   
    socket.on('message', function(data) {
        io.to(data.ROOM_ID).emit('showMsg', {MESSAGE : data.MESSAGE, USER_ID: data.USER_ID});
    });
    
    socket.on('refresh', function(data) {
        for (var i = 0; i < ROOM_LIST.length; i++) {
            if (data.ROOM_ID == ROOM_LIST[i].id) {
                ROOM_LIST[i].refresh++;
                io.to(data.ROOM_ID).emit('newGame', {count : ROOM_LIST[i].refresh});
                console.log(ROOM_LIST[i].refresh);
                break;
            }
        }
    });
    
    socket.on('resetGame', function(data) {
        for (var i = 0; i < ROOM_LIST.length; i++) {
            if (data.ROOM_ID == ROOM_LIST[i].id) {
                ROOM_LIST[i].refresh = 0;
                ROOM_LIST[i].winCount = 0;
                io.to(data.ROOM_ID).emit('clearCanvas', {});
                getPosInRoom(PLAYER_LIST[socket.id]);
                PLAYER_LIST[socket.id].canMove = true;
                break;
            }
        }
    });
})
 
setInterval(function() {
    var pack = [];
    for(var i in PLAYER_LIST) {
        var player = PLAYER_LIST[i];
        var socket = SOCKET_LIST[i];
        player.updatePosition();
        socket.emit('collision', {player : player});
        pack.push({
            x : player.x,
            y : player.y,
            color : player.color,
            room : player.room,
            key : player.key,
        });    
        socket.emit('newPositions', {pack});
    }
}, 1000/40);

function getColor(player) {
    var color = '#FFFFFF';
    if (player.count == 1) {
        color = '#FF0000';
    } else if (player.count == 2) {
        color = '#00FF00';
    } else if (player.count == 3) {
        color = '#0000FF';
    } else if (player.count == 4) {
        color = '#800080';
    }
    player.color = color;
    return;
}

function getPosInRoom(player) {
    if (player.count == 1) {
        player.x = 125;
        player.y = 125;
    } else if (player.count == 2) {
        player.x = 125;
        player.y = 375;
    } else if (player.count == 3) {
        player.x = 375;
        player.y = 125;
    } else if (player.count == 4) {
        player.x = 375;
        player.y = 375;
    }
    return;
}

function getWinner(room) {
    var winner;
    for (var i in PLAYER_LIST) {
        if (PLAYER_LIST[i].room == room && PLAYER_LIST[i].canMove) {
            winner = PLAYER_LIST[i];
            PLAYER_LIST[i].canMove = false;
        }
    }
    return winner;
}

http.listen(app.get('port'), function(){
    console.log('Server running...');
});