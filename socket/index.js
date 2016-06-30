var log = require('lib/log')(module);
var async = require('async');
var config = require('config');
var cookieParser = require('cookie-parser');
var sessionStore = require('lib/sessionStore');
var HttpError = require('error').HttpError;
var User = require('models/user').User;
var Team = require('models/team').Team;
var Character = require('models/character').Character;

function loadSession(sid, callback) {
    sessionStore.load(sid, function (err, session) {
        if (arguments.length == 0) {
            //no arguments => no session
            return callback(null, null);
        } else {
            return callback(null, session);
        }
    });
}

function loadUser(session, callback) {
    if (!session.user) {
        return callback(null, null);
    }

    User.findById(session.user, function (err, user) {
        if (err) return callback(err);

        if (!user) {
            return callback(null, null);
        }
        callback(null, user);
    })
}

module.exports = function (server) {

    var secret = config.get('session:secret');
    var sessionKey = config.get('session:key');

    var io = require('socket.io').listen(server);

    io.use(function (socket, next) {
        var handshakeData = socket.request;

        async.waterfall([
            function (callback) {
                //получить sid
                var parser = cookieParser(secret);
                parser(handshakeData, {}, function (err) {
                    if (err) return callback(err);

                    var sid = handshakeData.signedCookies[sessionKey];
                    loadSession(sid, callback);
                });
            },
            function (session, callback) {
                if (!session) {
                    return callback(new HttpError(401, "No session"));
                }
                socket.handshake.session = session;
                loadUser(session, callback);
            },
            function (user, callback) {
                if (!user) {
                    return callback(new HttpError(403, "Anonymous session may not connect"));
                }
                callback(null, user);
            }
        ], function (err, user) {

            if (err) {
                if (err instanceof HttpError) {
                    return next(new Error('not authorized'));
                }
                next(err);
            }

            socket.handshake.user = user;
            next();
        });

    });

    io.on('connection', function (socket) {
        var username = socket.handshake.user.username;
        //Первоначально юзер входит в комнату всего сервера
        var serverRoom = "server:room";
        socket.join(serverRoom);
        //а затем в свою собственную комнату
        var userRoom = "user:room:" + username;
        socket.join(userRoom);
        var battleRoom; //Комната для битв
        var battleStart; //Определяет, началась битва или нет

        var arenaLobby = "arenaLobby:room"; //Очередь на арену

        //Отправляем всем игрокам на сервере сообщение об изменении
        //количества человек на сервере
        var serverOnlineUsers = Object.keys(io.nsps["/"].adapter.rooms[serverRoom].sockets).length;
        io.sockets.in(serverRoom).emit('join', serverOnlineUsers, username);
        log.info("User "+username+" join game");

        //Обновляем у пользователя время последнего визита
        User.setById(socket.handshake.user._id, {lastVisit: new Date()}, function(err, user) {
            if (err) socket.emit("customError", err);
        });

        socket.on('disconnect', function () {
            if(io.nsps["/"].adapter.rooms[serverRoom]) { //Проверка на то, что я последний человек на сервере
                serverOnlineUsers = Object.keys(io.nsps["/"].adapter.rooms[serverRoom].sockets).length;
                socket.broadcast.to(serverRoom).emit('leave', serverOnlineUsers); //Покидаем сервер
                log.info("User "+username+" leave game");
                //И выкидываем из боя оппонента, если сами вышли
                if (battleRoom) {
                    if(battleStart){
                        //Вылетевшей команде засчитываем поражение
                        var userId = socket.handshake.user._id;
                        Team.getByUserIdPop(userId, function(err, team){
                            if (err) socket.emit("customError", err);
                            var rateChange = 0;
                            if(team.rating-25>=1000) rateChange=25;
                            Team.setById(team._id, {
                                rating: team.rating-rateChange,
                                souls: {red: team.souls.red+2, green: team.souls.green+2, blue: team.souls.blue+2},
                                loses: team.loses+1
                            }, function(err, team){
                                if (err) socket.emit("customError", err);
                                Character.find({_team: team._id}, function(err, chars){
                                    if (err) socket.emit("customError", err);
                                    for(var i=0;i<chars.length;i++){
                                        Character.setById(chars[i]._id, {lose: true}, function(err){
                                            if (err) socket.emit("customError", err);
                                        });
                                    }
                                });
                            });
                        });
                    }

                    //Выкидываем оппонента
                    if(io.nsps["/"].adapter.rooms[battleRoom]){
                        var battleSockets = Object.keys(io.nsps["/"].adapter.rooms[battleRoom].sockets);
                    }
                    if (battleSockets) {
                        socket.broadcast.to(battleRoom).emit('enemyLeave');
                        io.sockets.connected[battleSockets[0]].leave(battleRoom);
                    }
                }
            }
            Team.deleteDummies(socket.handshake.user._id);
        });

        socket.on('getUserName', function () {
            socket.emit("getUserNameResult", socket.handshake.user.username);
        });

        socket.on('createChar', function(){
            var userId = socket.handshake.user._id;
            Team.findOne({teamName: "newTeam_"+userId}, function(err, team){
                if(err) socket.emit("customError", err);
                if(team!=null){
                    Character.create(team._id, function(err, char){
                        if (err) socket.emit("customError", err);
                        if(char) socket.emit("createCharResult");
                        else log.error("Can create character");
                    });
                }
                else {
                    socket.emit("customError", "Team not found");
                }
            });
        });

        socket.on('removeChar', function(teamId, charId){
            //Сперва удалим персонажа у команды
            Team.findByIdAndUpdate(teamId, {$pull: {characters: charId}}, function(err, team){
                if(err) socket.emit("customError", err);
                //А потом удалим и его самого
                Character.findByIdAndRemove(charId, function(err){
                    if (err) socket.emit("customError", err);
                    socket.emit("removeCharResult");
                });
            });
        });

        socket.on('getChar', function(cond){
            Character.findOne(cond, function(err, char){
                if (err) socket.emit("customError", err);
                if(char) socket.emit("getCharResult", char);
                else socket.emit("getCharResult");
            });
        });

        socket.on('getDummyChar', function(){
            var userId = socket.handshake.user._id;
            Team.findOne({teamName: "newTeam_"+userId}, function(err, team){
                if(err) socket.emit("customError", err);
                Character.findOne({charName: "newChar_"+team._id}, function(err, char){
                    if (err) socket.emit("customError", err);
                    if(char){
                        char.populate('_team', function(err, popChar) {
                            if (err) socket.emit("customError", err);
                            socket.emit("getDummyCharResult", popChar);
                        });
                    }
                    else {
                        log.error("Can't populate null dummy character.");
                        if(userId) { log.error("userId: "+userId)};
                        if(team) { log.error("newChar: newChar_"+team._id)};
                    }
                });
            });
        });

        socket.on('setChar', function(cond){
            Character.findByIdAndUpdate(cond._id, {$set: cond}, {upsert: true}, function(err, char){
                if (err) socket.emit("customError", err);
                socket.emit("setCharResult");
            });
        });

        socket.on('createTeam', function(){
            Team.create(socket.handshake.user._id, function(err, data){
                if (err) socket.emit("customError", err);
            });
        });

        socket.on('getDummyTeam', function(){
            var userId = socket.handshake.user._id;
            //Пытаемся найти уже существующую dummy
            Team.getDummy(userId, function (err, team) {
                if (err) socket.emit("customError", err);
                if(team){
                    socket.emit("getDummyTeamResult", team);
                }
                //Если не нашли, создаём её
                else
                {
                    Team.create(socket.handshake.user._id, function(err, newTeam){
                        if (err) socket.emit("customError", err);
                        socket.emit("getDummyTeamResult", newTeam);
                    });
                }
            });
        });

        socket.on('getTeam', function(cond){
            Team.findOne(cond, function(err, team){
                if (err) socket.emit("customError", err);
                if(team) socket.emit("getTeamResult", team);
                else socket.emit("getTeamResult");
            });
        });

        socket.on('setTeam', function(cond){
            Team.findByIdAndUpdate(cond._id, {$set: cond}, {upsert: true}, function(err, team){
                if (err) socket.emit("customError", err);
                socket.emit("setTeamResult");
            });
        });

        socket.on('removeDummyTeam', function(){
            Team.deleteDummies(socket.handshake.user._id, function (err, data) {
                if (err && err.status!='no team') socket.emit("customError", err);
            });
        });

        socket.on('removeUsersDummies', function() {
            User.getAll(function (err, users) {
                if (err) socket.emit("customError", err);

                for (var i = 0; i < users.length; i++) {
                    Team.deleteDummies(users[i]._id);
                }
            });
        });

        socket.on('deleteTeam', function(teamId){
            Team.deleteTeam(teamId, function(err){
                if (err) {
                    socket.emit("customError", err);
                }
            });
        });

        socket.on('checkUserTeam', function(){
            var userId = socket.handshake.user._id;
            Team.deleteDummies(userId, function (err, data) {
                if (err && err.status!='no team') socket.emit("customError", err);

                User.getById(userId, function(err, findedUser) {
                    if (err) socket.emit("customError", err);
                    if(findedUser.team) {
                        socket.emit("checkUserTeamResult", findedUser.team);
                    }
                    else {
                        socket.emit("checkUserTeamResult");
                    }
                });
            });
        });

        socket.on('getUserTeam', function(){
            var userId=0;

            //ОЧИСТКА БОЕВЫХ КОМНАТ
            if(battleRoom) {
                socket.leave(battleRoom);
                battleRoom=undefined;
            }
            userId = socket.handshake.user._id;

            Team.getByUserIdPop(userId, function(err, team){
                if (err) socket.emit("customError", err);
                if(!team) {
                    //Если тима не найдена, значит она была удалена, а ссылка на неё осталась
                    User.findByIdAndUpdate(userId, {$set: {team: undefined}}, {upsert: true}, function(err, user){
                        if (err) socket.emit("customError", err);
                        socket.emit("getUserTeamResult", null);
                    });
                }
                else {
                    Team.findRank(team._id, function (err, rank) {
                        if (err) socket.emit("customError", err);

                        //Отправим (текущее время на сервере - время последнего рола)
                        var nowTime = new Date();

                        socket.emit("getUserTeamResult", team, rank, (nowTime - team.lastRoll));
                    });
                }
            });
        });

        socket.on('getAllUsersPop', function(){
            var usersList = [];
            User.getAll(function(err, users){
                if (err) socket.emit("customError", err);
                var serverSockets = io.of('/').in(serverRoom).connected;
                async.each(users, function(user, callback) {
                    var currentUser = user;
                    currentUser._doc.isOnline = false;
                    //Проверяем онлайн игрока
                    for (var socketId in io.nsps["/"].adapter.rooms[serverRoom].sockets) {
                        if(io.nsps["/"].adapter.rooms[serverRoom].sockets.hasOwnProperty(socketId)){
                            var socketItem = serverSockets[socketId];
                            if (currentUser.id === socketItem.handshake.user.id) {
                                currentUser._doc.isOnline=true;
                            }
                        }
                    }
                    if(user.team){
                        user.populate('team', function(err, userWithTeam){
                            if (err) return callback(err);
                            currentUser = userWithTeam;
                            currentUser.team.populate('characters', function(err, teamWithChars){
                                if (err) return callback(err);
                                currentUser.team = teamWithChars;
                                usersList.push(currentUser);
                                callback(null);
                            });
                        })
                    }
                    else {
                        usersList.push(currentUser);
                        callback(null);
                    }
                }, function(err){
                    if (err) socket.emit("customError", err);
                    socket.emit('getAllUsersPopResult', usersList);
                });
            });
        });

        socket.on('joinArenaLobby', function(){
            socket.join(arenaLobby);
            log.info("User "+username+" join arena");
            io.sockets.in(serverRoom).emit('someoneJoinArena');
            var queue = Object.keys(io.nsps["/"].adapter.rooms[arenaLobby].sockets);
            io.sockets.in(serverRoom).emit('arenaQueueChanged', queue.length);
            //Если найдено 2 человека в очереди
            if(queue.length>1){
                //Формируем уникальный ключ комнаты для боя
                battleRoom = "battle:"+queue[0]+"_VS_"+queue[1];
                if (io.sockets.connected[queue[0]] && io.sockets.connected[queue[1]]) {
                    var groundType = Math.floor(Math.random() * 3); //Рандомим тип местности здесь, чтобы он совпал у игроков
                    var availablePositions = [[0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0]]; //Все варианты расстановок группы
                    var allyPositions = availablePositions[Math.floor(Math.random() * 6)];
                    var enemyPositions = availablePositions[Math.floor(Math.random() * 6)];

                    //Препятствия на карте
                    var availableWallPos=[];
                    for(var i=0;i<100;i++){
                        if(!(i<=10 || i%10===0 || i%10===9 || i>=90 || i===18 || i===81)){
                            availableWallPos.push(i);
                        }
                    }
                    var shuffledWallPos= shuffle(availableWallPos);
                    var allyWallPositions = [];
                    var enemyWallPositions = [];
                    for(i=0;i<10;i++) {
                        allyWallPositions.push(shuffledWallPos[i]);
                        //для противника меняем местами координаты препятствий
                        var reversedIndex=""+Math.floor(shuffledWallPos[i]%10)+Math.floor(shuffledWallPos[i]/10);
                        enemyWallPositions.push(+reversedIndex);
                    }

                    //Изначальные данные для битвы
                    var allyBattleData = {
                        battleRoom: battleRoom,
                        groundType: groundType,
                        allyPartyPositions: allyPositions,
                        enemyPartyPositions: enemyPositions,
                        wallPositions: allyWallPositions
                    };
                    //Для НЕорганизатора боя места меняются местами
                    var enemyBattleData = {
                        battleRoom: battleRoom,
                        groundType: groundType,
                        allyPartyPositions: enemyPositions,
                        enemyPartyPositions: allyPositions,
                        wallPositions: enemyWallPositions
                    };

                    log.info("User "+io.sockets.connected[queue[0]].handshake.user.username+" start battle with "+io.sockets.connected[queue[1]].handshake.user.username);
                    io.sockets.connected[queue[0]].emit('startBattle', allyBattleData);
                    io.sockets.connected[queue[1]].emit('startBattle', enemyBattleData);
                    io.sockets.connected[queue[0]].leave(arenaLobby);
                    io.sockets.connected[queue[1]].leave(arenaLobby);
                    io.sockets.in(serverRoom).emit('arenaQueueChanged', 0);
                    io.sockets.connected[queue[0]].join(battleRoom);
                    io.sockets.connected[queue[1]].join(battleRoom);
                }
            }
        });

        socket.on('getArenaQueue', function(){
            if(io.nsps["/"].adapter.rooms[arenaLobby]) {
                var queue = Object.keys(io.nsps["/"].adapter.rooms[arenaLobby].sockets);
                io.sockets.in(serverRoom).emit('arenaQueueChanged', queue.length);
            }
        });

        socket.on('leaveArenaLobby', function(){
            log.info("User "+username+" leave arena");
            io.sockets.in(serverRoom).emit('arenaQueueChanged', 0);
            socket.leave(arenaLobby);
        });

        socket.on('checkOpponent', function(room) {
            socket.broadcast.to(room).emit('areYouReadyToBattle');
        });

        socket.on('areYouReadyToBattleResponse', function(room) {
            socket.broadcast.to(room).emit('opponentReady');
        });

        socket.on('getAlliesAndEnemies', function(room) {
            if(!battleRoom) {
                battleRoom = room; //присваивание battleRoom Для второго сокета
            }
            if(!room || !battleRoom) return;
            var battleSocket=Object.keys(io.nsps["/"].adapter.rooms[room].sockets);
            var allyUserId;
            var enemyUserId;
            var allyTeam ={};
            var enemyTeam ={};
            if(battleSocket[0]==socket.id){
                allyUserId = io.sockets.connected[battleSocket[0]].handshake.user._id;
                enemyUserId = io.sockets.connected[battleSocket[1]].handshake.user._id;
            }
            else {
                allyUserId = io.sockets.connected[battleSocket[1]].handshake.user._id;
                enemyUserId = io.sockets.connected[battleSocket[0]].handshake.user._id;
            }

            //Сперва ищем свою команду
            User.findById(allyUserId, function(err, allyUser){
                if(err) socket.emit("customError", err);
                //Наполняем её
                Team.getTeamPop({_id: allyUser.team}, function(err, popAllyTeam){
                    if(err) socket.emit("customError", err);
                    allyTeam=popAllyTeam;
                    //Если всё прошло удачно
                    if(allyTeam){
                        //Ищём чужую команду
                        User.findById(enemyUserId, function(err, enemyUser) {
                            if (err) socket.emit("customError", err);
                            //Наполняем её
                            Team.getTeamPop({_id: enemyUser.team}, function (err, popEnemyTeam) {
                                if (err) socket.emit("customError", err);
                                enemyTeam = popEnemyTeam;
                                //если всё удачно, то отправляем тимы клиенту
                                if(enemyTeam){
                                    battleStart=true;
                                    socket.emit('getAlliesAndEnemiesResult', allyTeam, enemyTeam);
                                }
                            });
                        });
                    }
                });
            });
        });

        socket.on('enemyTeamLoaded', function(room) {
            socket.broadcast.to(room).emit('enemyTeamLoadedResult');
        });

        socket.on('combatLogUpdate', function(room, message) {
            socket.broadcast.to(room).emit('combatLogUpdateSend', message);
        });

        socket.on('turnEnded', function(room, char, turnsSpended) {
            io.sockets.in(room).emit('turnEndedResult', char, ++turnsSpended);
        });

        socket.on('updateActiveTeam', function(room, chars) {
            socket.broadcast.to(room).emit('updateActiveTeamResult', chars);
        });

        socket.on('updateTeams', function(room, chars1, chars2) {
            io.sockets.in(room).emit('updateTeamsResult', chars1, chars2);
        });

        socket.on('deleteUser', function(id) {
            var userId = id;
            User.findById(userId, function(err, foundedUser) {
                if(foundedUser.team) {
                    Team.deleteTeam(foundedUser.team, function(err){
                        if (err) socket.emit("customError", err);
                        User.remove({_id: userId}, function(err) {
                            if (err) socket.emit("customError", err);
                            socket.emit("deleteUserResult");
                        });
                    });
                }
                else {
                    User.remove({_id: userId}, function(err) {
                        if (err) socket.emit("customError", err);
                        socket.emit("deleteUserResult");
                    });
                }

            });
        });

        socket.on('sendChatMessage', function (channel, msg) {
            log.info("User "+msg.sender+" wrote: "+msg.text);
            switch(channel) {
                case 'common' : io.sockets.in(serverRoom).emit('newMessage', msg, channel); break;
                case 'arena' : if(battleRoom) io.sockets.in(battleRoom).emit('newMessage', msg, channel); break;
            }
        });

    });

    //Функция перемешивания
    function shuffle (array) {
        var currentIndex = array.length, temporaryValue, randomIndex;

        // While there remain elements to shuffle...
        while (0 !== currentIndex) {

            // Pick a remaining element...
            randomIndex = Math.floor(Math.random() * currentIndex);
            currentIndex -= 1;

            // And swap it with the current element.
            temporaryValue = array[currentIndex];
            array[currentIndex] = array[randomIndex];
            array[randomIndex] = temporaryValue;
        }

        return array;
    }

    //Вариант обновления всей базы
    //Character.find({}, function(err, chars){
    //    if (err) socket.emit("customError", err);
    //    log.info("Total chars: "+chars.length);
    //    chars.forEach(function(char, i) {
    //        if(char.portrait)
    //        {
    //            if(char.portrait.length>0){
    //                char.portrait = char.portrait.replace("images/portraits/", "images/assets/img/portraits/");
    //                char.save(function(err, char){
    //                    log.info("RENAME ready for "+i+": "+char.charName);
    //                    if (err) socket.emit("customError", err);
    //                });
    //            }
    //        }
    //    });
    //    log.info("READY");
    //});

    return io;
};
